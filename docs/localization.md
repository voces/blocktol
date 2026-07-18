# Localization — implementation tracker

Status: **in progress**, burning down as work lands. The catalog, codegen, typed
runtime, and the first consumer (notification copy) are **shipped** — their
architecture now lives in code and in CLAUDE.md → _Localization (i18n)_, so it's
been removed from here. What remains is tracked below; when it's all done this
file is deleted.

Goals (unchanged): every user-facing word flows through one message catalog
(client copy, in-app notification copy, server push copy alike); untranslated
functionality cannot deploy (CI-enforced, not by discipline); ICU
MessageFormat + `Intl.*` for all formatting (no hand-rolled plural ternaries,
month arrays, or relative-time math); and no divergence between surfaces.

## Shipped

- **Catalog + codegen + typed runtime.** `i18n/en.json` (ICU, source of truth) →
  `scripts/genI18n.ts` → `common/i18n.generated.ts` (gitignored, pre-parsed
  AST + `MessageKey`/`MessageParams` derived from `en.json`); `common/i18n.ts`
  exports the pure `t(locale, key, params)`; `scripts/i18nParse.ts` is the
  build-only ICU parser, so no parser ships in the client bundle. Wired into
  `build`/`dev`/`test` and CI (before `deno check`); `.gitignore` + `fmt`
  exclude the generated file. Unit-tested in `common/i18n.test.ts`. Full
  description in CLAUDE.md.
- **Notification & server-rendered copy.** `notificationText` renders through
  the catalog (`notif.*` keys; `DailyVariant` → key via a literal ternary).
  Server passes the recipient's `user.locale`, the in-app panel omits locale
  (viewer's own) — same single source, no stored-payload change, history
  re-renders in any language for free.

## Remaining

### Client `t()` wiring + embedded markup

- **`client/util/t.ts`** — wrap `common/i18n.ts`'s `t` with the client's
  UI-locale signal so `t(key, params)` reads the current locale and a language
  switch re-renders live (signals, no context provider).
- **`tJsx`** — for messages with embedded markup (a bolded name inside a
  sentence), keep the message one string with placeholder tags
  (`"Use {link}Move to another device{/link} from your profile"`) and map tags
  to elements; never concatenate sentence fragments across JSX boundaries
  (untranslatable in languages with different word order).

### Locale resolution & the language setting

Two distinct concepts. `resolveCatalog` (shipped) already does the best-fit tag
→ prefix → `en` resolution; what's left is the user-facing choice:

- **UI language** — new `language` key in `common/settings.ts` (+ its zod in
  `setSettings.ts`): `"auto"` (default) or a supported tag. `"auto"` negotiates
  `navigator.languages` against the supported list.
- **Formatting locale** — follows the UI language when explicitly chosen; under
  `"auto"`, keep the browser's full locale (an `en-GB` user gets `en` copy with
  British conventions — `Intl` already handles this via the full tag).
- On resolution/change, set `document.documentElement.lang` (screen readers,
  hyphenation, CJK font selection).
- **Picker** in Profile → Appearance, each option labelled via
  `Intl.DisplayNames` in its **own** language ("Deutsch", "日本語").
- **Push copy language:** an explicit choice also updates `user.locale` (the
  column the notification join reads) so lock-screen text matches the chosen UI
  language; passive capture stays the fallback and keeps its never-clobber rule.

### Loading & bundle strategy

`en` compiles into the main bundle today (the generated module is imported from
`common/`). When non-English catalogs land, split each into its own module under
`public/js/i18n/<locale>.js`, dynamically imported when active (the `pathing.js`
separate-bundle precedent), so the main bundle doesn't grow linearly with locale
count. The service worker caches the active locale's module like any asset.

### Dates, numbers, plurals — close the gaps

- Replace `Calendar.tsx`'s hardcoded `MONTHS`/`WEEKDAYS` with
  `Intl.DateTimeFormat` parts in the app locale.
- Replace the hand-rolled relative-time helpers (`Standings/helpers.ts`,
  `Attempts.tsx`'s `formatWhen`) with `Intl.RelativeTimeFormat`.
- Replace every English plural ternary (`runs(n)` in `MoveGate`, "N players", "N
  unread", "best of N") with ICU `{n, plural, ...}` messages.
- `common/format.ts` stays the number layer, unchanged; thread the app locale
  where `undefined` is passed today. The local-date construction rule (build
  `new Date(y, m-1, d)` so formatting can't shift a day across midnight) carries
  over untouched.

### Extract the remaining client copy

~20 client files still hold English literals (MoveGate, Profile, the IntroBoard
tutorial, Attempts, standings, the notifications panel, the daily/prestart
cards, error/disconnected overlays, aria-labels). Extract each into `en.json`
with a `description` and replace with `t()`/`tJsx()`. English-only until the
pipeline lands; the app must render byte-identically at each step.

### Server errors become codes

The three `UserError` messages ("no daily available for that date yet", "invalid
timeZone", the auth error) become stable **codes** in the 400 body (message kept
alongside for legacy clients); the client maps `error.<code>` through the
catalog. New user-facing server errors ship as codes — the server never again
embeds English destined for a screen.

### The pipeline: how "never deploy untranslated" is enforced

Three mechanisms, layered — a gate, an auto-fixer, and a leak detector.

**1. The gate: `deno task i18n:check` (CI, blocking).** Fails the build when,
for any supported locale, any key is **missing**, **stale** (stored hash ≠
current hash of the en message), or **orphaned** (absent from en.json), or when
a message fails validation: ICU parses; **placeholder parity** (translation uses
exactly the source's args); **plural-category coverage** (every plural supplies
the CLDR categories its locale requires). Target catalogs gain a `hash` field
(SHA-256 of the source message) — the staleness mechanism. Runs between lint and
typecheck; this check alone is the guarantee.

**2. The auto-fixer: `deno task i18n:translate`.** Fills every missing/stale
entry with an LLM. Per batch it feeds the source messages + `description`s, the
ICU contract, the **glossary** (`i18n/glossary.json` — pinned game terms:
runner, brick, thunder, daily, free play, ranked, SUPREME/RECORD/BEST, the
DELETE sentinel), and the locale's existing neighbouring translations for tone.
Output is validated by the gate's checks before being written; a dropped
placeholder or plural branch is rejected and retried.

The provider sits behind a one-method `Translator` interface (batching +
prompt + validate/retry above it, vendor-agnostic). The **default adapter calls
the Anthropic Messages API directly** via `npm:@anthropic-ai/sdk` — no external
gateway — and exploits prompt caching (the ICU contract + glossary is a
byte-stable prefix, marked `cache_control: ephemeral`, read at ~0.1× across
batches/locales) and the Message Batches API (50% off; translation is never
latency-sensitive). Config: `ANTHROPIC_API_KEY` + `TRANSLATE_MODEL` (pinned in
config). Swapping providers is a new adapter (e.g. an OpenAI-compatible one at a
self-hosted LiteLLM proxy / OpenRouter), everything above the seam untouched —
the same depend-on-a-stable-seam posture as the SQL proxy shape and
`BlocktolApi`.

**Automation:** a GitHub Action triggers on PRs touching `i18n/en.json` (or when
`i18n:check` fails), runs the translate task with the `ANTHROPIC_API_KEY` repo
secret (workflow needs `contents: write` to push back), and commits the catalogs
to the PR branch. Edit `en.json`, push, the PR translates itself; the gate still
verifies independently, so a broken pipeline fails loudly rather than deploying
English. Machine-written catalogs are committed unreviewed by design (the gate
is structural validity, not human sign-off) — the glossary pins vocabulary,
descriptions constrain register, and a retranslate-on-edit loop makes fixes one
`description` tweak away.

**3. The leak detector: no hardcoded strings in JSX.** A Deno lint plugin (Deno
2.2+) flags JSX text literals and user-facing props (`aria-label`, `title`,
`alt`, `placeholder`) outside an allowlist (`Blocktol`, `·`, digits, CSS-ish
values), run as its own scoped step (`client/` is otherwise lint-excluded). The
same rule enforces **never interpolate a key**. A **pseudo-locale** `en-XA`
(mechanical accents + ~40% length padding + delimiters), dev-only, catches
concatenation/overflow bugs before real locales ship.

**String lifecycle.** `en.json` is the authority — a target key exists only
because en does. Removing a source key: the translate/sync task prunes it from
targets (and the Action runs it), with the gate's orphan check as backstop; a
dangling code reference is already a `deno check` error (derived `MessageKey`).
Unused-key detection is `deno task i18n:unused` (walks `t()`/`tJsx()`/error-code
call sites, diffs against en.json) — a **hard CI gate from day one**: greenfield

- the no-interpolation convention makes the scan exact, and with no target
  catalogs yet a removal is a trivial one-file edit.

### Initial locale set

Chosen for puzzle-game reach, strong LLM translation quality, and **no RTL in
v1** (RTL needs a CSS logical-properties audit — a separate, later project; the
board is direction-neutral).

**Tier 1 (launch):** `en` (source), `es` (one neutral variant; split `es-419`
later if demand shows), `pt-BR`, `fr`, `de` (the length stress-test — QA layout
here), `ja` (QA CJK wrap + `lang` font selection), `zh-Hans`.

**Tier 2 (fast follow, ~zero marginal cost):** `ko`, `it`, `pl`, `nl`, `tr`,
`ru`.

**Deferred pending RTL audit:** `ar`, `he`.

Seven launch locales is a deliberate cap: translation is free but **layout QA is
not** — each tier-1 locale gets one manual pass through the dense surfaces
(MoveGate, Profile, the standings sheet, the daily card) before the list grows.

### Deliberately out of scope (stays English)

- **Discord posts** (`dailyAnnounce`, `pbBoard`) — one shared community channel;
  its language is a channel decision.
- **`public/privacy.html`** — a legal document; machine translation has
  accuracy/legal implications. Revisit with an "informational translation"
  banner if demand appears.
- **`manifest.webmanifest` + `index.html` meta description** — install-time /
  SEO metadata in a static shell (`document.title` can localize at runtime
  cheaply; the rest waits for a per-locale-shell decision).
- **The board** — no text; nothing to do.
- The `DELETE` confirm sentinel **is** localized (typing a foreign word to
  confirm deletion is a dark-pattern accessibility problem), pinned in the
  glossary.

## Rollout

1. **Foundation** — _partly shipped_: catalog + codegen + `t()` + notification
   migration + build/CI wiring done. Remaining: `client/util/t.ts` + `tJsx`, the
   `language` setting + `lang` attribute, formatting-gap closures, and
   extracting the remaining ~300 client strings (English-only, byte-identical).
2. **Pipeline** — `i18n:check` + `i18n:translate` + glossary + pseudo-locale +
   JSX lint rule + `i18n:unused` + the GitHub Action.
3. **Launch tier 1** — generate the six non-English catalogs, QA per locale on
   the dense surfaces, ship the language picker, wire choice → `user.locale`.
4. **Follow-ups** — server error codes, runtime `document.title`, tier 2, RTL
   audit, revisit privacy-policy translation.
