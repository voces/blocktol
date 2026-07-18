# Localization strategy

Status: **proposal** — nothing here is implemented yet. This document decides
the architecture, tooling, enforcement model, and initial locale set for full
localization of Blocktol: UI copy, notification/push copy, dates, numbers, and
plurals. It is written to be executed in phases (see the rollout plan at the
bottom) and to be deleted or folded into CLAUDE.md once the work ships.

## Goals

1. **Every user-facing word flows through one message catalog** — client copy,
   in-app notification copy, and server-rendered push copy alike.
2. **Untranslated functionality cannot deploy.** Translation is enforced by CI,
   not by discipline: a new or changed source string that lacks a current
   translation in every supported locale fails the build, and a pipeline step
   produces those translations automatically (LLM-based) so the gate is cheap to
   satisfy.
3. **Standardized formats and platform APIs.** ICU MessageFormat for message
   syntax; `Intl.*` (NumberFormat, DateTimeFormat, PluralRules,
   RelativeTimeFormat, DisplayNames) for all formatting. No hand-rolled plural
   ternaries, month-name arrays, or relative-time math.
4. **No divergence between surfaces.** The push text and the in-app panel
   already share `notificationText`; localization must preserve that
   single-source property, not fork it per language.

## What already exists (don't rebuild it)

The plumbing half of localization shipped incrementally and is sound:

- **`user.locale`** — a BCP-47 tag captured passively when a device subscribes
  to push (`server/routes/push/subscribe.ts`, canonicalised via
  `Intl.getCanonicalLocales`, never clobbered by a bad value). Used today to
  render push copy's numbers/dates in the recipient's locale.
- **`common/format.ts`** — every number surface (`formatSeconds`, `formatCount`,
  `formatDecimal`) already takes an optional locale, caches `Intl.NumberFormat`
  per (locale, options), and falls back gracefully on a malformed tag. Client
  passes `undefined` (viewer's locale); server passes the recipient's stored
  locale.
- **Notifications are stored as data, not text.** A notification row is `kind` +
  a denormalized payload (`LostTopData` / `DailyFinalData` with its
  `DailyVariant` enum); `notificationText` renders words at read/delivery time.
  This is exactly the "notifications as enums" model — the payload never
  contains prose, so re-rendering in any language is already possible without a
  schema change.
- Most date rendering already goes through `Intl.DateTimeFormat` /
  `toLocaleDateString` with the viewer's locale.

What's missing is the **string layer**: all words are English literals inline in
JSX/TS, there is no catalog, no `lang` attribute handling, no language setting,
and a few formatting stragglers bypass `Intl` (hardcoded `MONTHS`/`WEEKDAYS`
arrays in `Calendar.tsx`, hand-rolled "3m ago" helpers, English plural ternaries
like `runs(n)`).

## Architecture

### Message format: ICU MessageFormat

Messages use ICU MessageFormat syntax — the industry interchange standard,
natively understood by every TMS, and (importantly for our pipeline) deeply
familiar to LLMs, which translate ICU plural/select skeletons reliably.

```
"attempts.sortNewest": "Newest",
"standings.players": "{date} · {count, plural, one {# player} other {# players}}",
"notif.lostTop.title": "You lost #1 on {date}"
```

Plural selection is backed by CLDR categories via `Intl.PluralRules` — which is
what makes languages like Polish (three plural forms) or Japanese (one) work
without per-language code.

### Catalog layout

```
i18n/
  en.json          # source of truth: { "key": { "message": "...", "description": "..." } }
  glossary.json    # game-term glossary fed to the translator (see pipeline)
  de.json          # target: { "key": { "message": "...", "hash": "<sha of en message>" } }
  es.json
  ...
```

- **`en.json` is the only file humans edit.** Each entry carries the ICU
  `message` plus a `description` — translator context ("button label", "shown
  when the run window expires", "SUPREME is a badge, keep it short").
  Descriptions are what make LLM translation accurate; write them as
  deliberately as the message.
- **Target catalogs are machine-written** (by the translate task, below) and
  committed. Each entry records the SHA-256 **hash of the exact source message
  it was translated from** — the staleness mechanism: editing an English string
  automatically invalidates every translation of it.
- Keys are stable, namespaced by surface (`profile.`, `attempts.`, `notif.`,
  `gate.`, `error.`), and never encode the English text — renaming copy must not
  rename keys.

### Typed runtime: a thin layer, not a framework

We deliberately do **not** adopt i18next / react-intl / Lingui / Fluent.
Rationale, briefly: this stack is Deno + `deno bundle` + Preact signals with no
Babel/webpack, and the same message renderer must run server-side (push copy per
recipient locale) and client-side (UI locale) from `common/` — the frameworks
above are either React-context-shaped, macro/build-plugin-shaped, or bring a
parallel non-ICU format. The catalog format above is standard; the runtime
around it is small enough to own, matching how this codebase already treats its
engine code. (Paraglide JS is the closest fit philosophically — compiled, typed
messages — but is npm-toolchain-centric; we take its ideas, not its tooling.)

Concretely, mirroring the `genVersion.ts` precedent:

- **`scripts/genI18n.ts`** (the `i18n` task, run by `build`/`dev`/CI before
  typecheck) compiles the catalogs into generated, gitignored modules under
  `common/i18n/` — one module per locale precompiling each ICU message to a
  plain function, plus a generated `MessageKey`/params type map **derived from
  `en.json`** (key → its ICU argument names/types). Precompiling means no ICU
  parser ships in the client bundle, and the derived types make a missing key or
  wrong param a compile error — the same type-derivation move as `BlocktolApi`.
- **`common/i18n.ts`** exports `t(locale, key, params)` — pure and
  framework-free so server push rendering and client rendering share it.
- **`client/util/t.ts`** wraps it with the client's locale signal:
  `t(key, params)` reads the current UI locale, so a language switch re-renders
  live (signals, no context provider).
- For messages with embedded markup (a bolded name inside a sentence), the
  message stays one string with placeholder tags
  (`"Use {link}Move to another device{/link} from your profile"`) and a small
  `tJsx` helper maps tags to elements — never concatenate sentence fragments
  across JSX boundaries, which is untranslatable in languages with different
  word order.

### Loading & bundle strategy

English compiles into the main bundle (zero-latency first paint, and the
guaranteed fallback). Every other locale compiles to its own small module under
`public/js/i18n/<locale>.js`, dynamically imported when that locale is active —
the `pathing.js` separate-bundle precedent. The service worker caches the active
locale's module like any other asset. Catalog size at our scale (~300 strings)
is a few KB per locale; this is about not growing the main bundle linearly with
locale count, not about weight today.

### Locale resolution & the language setting

Two distinct concepts, deliberately:

- **UI language** — which catalog renders. New `language` key in
  `common/settings.ts` (zod-validated): `"auto"` (default) or a supported tag.
  `"auto"` negotiates `navigator.languages` against the supported list
  (best-fit: exact tag, then language-only prefix, then `en`).
- **Formatting locale** — how dates/numbers render. Follows the UI language when
  explicitly chosen; under `"auto"`, keep using the browser's full locale (so an
  `en-GB` user gets `en` copy with British date order — `Intl` handles this for
  free by passing the browser tag).

On resolution (and on change), set `document.documentElement.lang` — required
for screen readers, hyphenation, and CJK font selection. The language picker
lives in Profile → Appearance, labelling each option via `Intl.DisplayNames` in
its **own** language ("Deutsch", "日本語"), the convention that survives a user
stuck in a language they can't read.

**Push copy language:** an explicit language choice also updates `user.locale`
(the column the notification join reads), so lock-screen text matches the UI
language the player chose rather than the device locale the subscribe path
passively captured. Passive capture remains the fallback and keeps its
never-clobber-with-worse rule.

### Dates, numbers, plurals — close the gaps

- Replace `Calendar.tsx`'s hardcoded `MONTHS`/`WEEKDAYS` with
  `Intl.DateTimeFormat` parts in the app locale.
- Replace the hand-rolled relative-time helpers (`Standings/helpers.ts`,
  `Attempts.tsx`'s `formatWhen`) with `Intl.RelativeTimeFormat`.
- Replace every English plural ternary (`runs(n)` in `MoveGate`, "N players", "N
  unread", "best of N") with ICU `{n, plural, ...}` messages.
- `common/format.ts` stays the number layer, unchanged; the app locale is simply
  threaded where `undefined` is passed today.
- The local-date construction rule (build `new Date(y, m-1, d)` so locale
  formatting can't shift a day across midnight) carries over untouched.

### Notification & server-rendered copy

`notificationText` keeps its exact shape and single-source role; only its
internals change: the hardcoded template literals become
`t(locale, key,
params)` lookups, with the `DailyVariant` enum mapping to
per-variant keys (`notif.dailyFinal.supreme`, `.record`, `.first`, `.t1`,
`.placed`). Server renders push copy with the recipient's `user.locale`; the
in-app panel renders the same keys in the viewer's UI locale. No stored payload
changes, no migration — history re-renders in whatever language the viewer uses
today, which is a feature of the data-not-text design.

### Server errors become codes

The three `UserError` messages ("no daily available for that date yet", "invalid
timeZone", the auth error) become stable error **codes** in the 400 body
(message kept alongside for legacy clients); the client maps `error.<code>`
through the catalog. New user-facing server errors must ship as codes — the
server never again embeds English destined for a screen.

### Deliberately out of scope (stays English for now)

- **Discord posts** (`dailyAnnounce`, `pbBoard`) — one shared community channel,
  not per-user; the channel's language is a channel decision.
- **`public/privacy.html`** — a legal document; machine-translating it has
  legal-accuracy implications. Revisit with a clearly-labelled "informational
  translation" banner if demand appears.
- **`manifest.webmanifest` + `index.html` meta description** — install-time and
  SEO metadata in a static shell; `document.title` can localize at runtime
  cheaply, the rest waits for a per-locale-shell decision that isn't worth its
  complexity yet.
- **The board itself** — no text in the maze; nothing to do.
- The `DELETE` confirm sentinel **is** localized (typing a foreign word to
  confirm deletion is a real dark-pattern accessibility problem), with its
  translation pinned in the glossary so it never drifts between releases.

## The pipeline: how "never deploy untranslated" is enforced

Three mechanisms, layered — a gate, an auto-fixer, and a leak detector:

### 1. The gate: `deno task i18n:check` (CI, blocking)

Fails the build when, for any supported locale, any key is **missing**,
**stale** (stored hash ≠ current hash of the en message), or **orphaned** (key
absent from en.json), or when any message fails validation:

- ICU syntax parses;
- **placeholder parity** — the translation uses exactly the source's arguments,
  no more, no fewer (the primary guard against LLM drift);
- **plural-category coverage** — every plural selector supplies exactly the CLDR
  categories its locale requires (`Intl.PluralRules.resolvedOptions`).

Runs in CI between lint and typecheck. This check alone is the guarantee: a PR
that adds a string without translations cannot merge.

### 2. The auto-fixer: `deno task i18n:translate`

Fills every missing/stale entry with an LLM. Per batch it feeds: the source
messages with their `description`s, the ICU syntax contract, the **glossary**
(`i18n/glossary.json` — pinned translations for game terms: runner, brick,
thunder, daily, free play, ranked, SUPREME/RECORD/BEST badges, the DELETE
sentinel), and that locale's existing translations of neighbouring keys for tone
consistency. Output is validated by the same checks as the gate before being
written — an LLM response that drops a placeholder or a plural branch is
rejected and retried, never committed.

**No hard dependency on any one model vendor.** The task talks to a
**provider-agnostic gateway over the OpenAI-compatible `/v1/chat/completions`
contract** — the de-facto standard shape every gateway and provider now speaks —
and is configured entirely by env: `TRANSLATE_BASE_URL` (the gateway endpoint),
`TRANSLATE_API_KEY`, and `TRANSLATE_MODEL` (a gateway-qualified id like
`anthropic/claude-...`, `openai/gpt-...`, `google/gemini-...`). Swapping the
model — or the vendor behind it — is a config change, never a code change, and
the gateway can fan a batch across models or fail one over to another without
the task knowing. This matches the codebase's existing posture of depending on a
stable wire contract (the SQL proxy's HTTP shape, `BlocktolApi`) rather than a
concrete backend. Two concrete ways to fill the endpoint, either fine:

- **Self-hosted gateway — [LiteLLM proxy](https://docs.litellm.ai/)** (or
  Cloudflare AI Gateway / Portkey / a bare LiteLLM container). One process you
  run that exposes the OpenAI shape and routes to whatever provider key you give
  it; keeps the provider keys on infra you control, adds request
  logging/caching, and is the right call if translation volume ever grows or you
  want the routing policy versioned. Deno talks plain HTTP to it — no SDK, no
  Python in this repo.
- **Hosted gateway — [OpenRouter](https://openrouter.ai/)** (or Vercel AI
  Gateway). One key, one base URL, a `vendor/model` string picks the model; zero
  infra to run. The lightest way to start, and because it's the same
  OpenAI-compatible contract, moving to a self-hosted LiteLLM later is just a
  base-URL + key swap.

Default recommendation: **start on OpenRouter** (nothing to operate), keep the
option to point `TRANSLATE_BASE_URL` at a self-hosted LiteLLM if volume or key-
custody ever justifies running one. The pinned model lives in config, not the
doc, so it can track whatever is best/cheapest at translation without a code
edit.

**Automation:** a GitHub Action triggers on PRs whose diff touches
`i18n/en.json` (or whenever `i18n:check` fails), runs the translate task with
the `TRANSLATE_*` values from repo secrets, and pushes the resulting catalog
commit back to the PR branch. The developer workflow is therefore: edit
`en.json`, push, and the PR translates itself; the gate still verifies
independently, so a broken pipeline (or a swapped-out model) fails loudly
instead of deploying English. Local `deno task i18n:translate` covers the
offline/faster path. Translation cost at this scale is noise (~300 short strings
× N locales, only diffs retranslate).

### 3. The leak detector: no hardcoded strings in JSX

The gate only sees strings that reach the catalog; the third layer stops new
English bypassing it. Deno 2.2+ supports custom lint plugins: a small rule flags
JSX text literals and user-facing string props (`aria-label`, `title`, `alt`,
`placeholder`) outside an explicit allowlist (`Blocktol`, `·`, digits, CSS-ish
values). `client/` is currently lint-excluded for unrelated reasons — this
plugin runs as its own scoped lint step in CI. Expect an initial
allowlist-tuning phase; the rule is a ratchet, not a day-one wall.

**Pseudo-locale:** the codegen also emits `en-XA` (mechanical accents + ~40%
length padding + delimiters), dev-only and excluded from the supported list. Ten
minutes with it staged catches concatenation bugs and overflow before any real
locale ships — German and Finnish will find the same bugs later, in production,
otherwise.

### String lifecycle: removal, orphans, and dead-key detection

`en.json` is the authority — a key exists in a target catalog only because it
exists in `en.json` — so string removal and dead-copy detection both key off it.

**Removing a source string** is a one-file edit: delete the key from `en.json`.
Two mechanisms clean up after it. The translate/sync task **prunes** that key
from every target catalog on its next run (the pass that fills missing keys also
deletes orphaned ones), and the GitHub Action that fires on `en.json` changes
runs it automatically. The gate's **orphan check** (§1) is the backstop: any
target-catalog key absent from `en.json` fails CI, so a stale `de.json` entry
can't linger even if the prune is skipped or a target was hand-edited. The
reverse — code still referencing a key you deleted from `en.json` — needs no new
tooling: `MessageKey` is a union derived from `en.json`, so a dangling reference
is a **compile error** at `deno check`.

**Detecting unused keys** — present in `en.json`, referenced by no code — is a
dedicated task, `deno task i18n:unused`: it walks server + common + client for
`t()`/`tJsx()`/error-code call sites, collects the literal keys, and diffs
against `en.json`; anything with zero references is dead copy. The one wedge is
**computed keys** (`notif.dailyFinal.${variant}` never appears as a literal), so
the convention is **never interpolate a key** — map an enum to its key through
an object literal (`{ supreme: "notif.dailyFinal.supreme", … }`) so every live
key appears verbatim exactly once and the scan is exact. That no-interpolation
rule is enforced by the same lint plugin that catches hardcoded strings (§3).
Posture: run `i18n:unused` as a **non-blocking CI report** first — a missed
dynamic pattern shouldn't block an unrelated PR — then flip it to blocking once
the convention is lint-enforced, at which point dead copy can't accumulate.

### Review posture for machine translations

Machine-written catalogs are committed unreviewed by design — the deploy gate is
structural validity, not human sign-off (there is no human per language).
Mitigations: the glossary pins the vocabulary that matters; descriptions
constrain register; and an in-app "translation feedback" affordance can wait
until there's evidence anyone needs it. Accept that early translations will have
rough edges; the pipeline retranslating on any source edit means fixes are one
`description` tweak away.

## Initial locale set

Chosen for: puzzle-game audience reach, strong LLM translation quality, and **no
RTL requirement in v1** (RTL needs a CSS logical-properties audit of the whole
shell — a separate, later project; the board itself is direction-neutral).

**Tier 1 (launch):**

| Locale    | Language             | Notes                                                     |
| --------- | -------------------- | --------------------------------------------------------- |
| `en`      | English              | source                                                    |
| `es`      | Spanish              | one neutral variant; split `es-419` later if demand shows |
| `pt-BR`   | Portuguese (Brazil)  | large casual-game market                                  |
| `fr`      | French               |                                                           |
| `de`      | German               | the length stress-test; QA layout here                    |
| `ja`      | Japanese             | puzzle-game culture; QA CJK wrap/`lang` font selection    |
| `zh-Hans` | Chinese (Simplified) |                                                           |

**Tier 2 (fast follow, pipeline makes each ~zero marginal cost):** `ko`, `it`,
`pl`, `nl`, `tr`, `ru`.

**Deferred pending RTL audit:** `ar`, `he`.

Seven launch locales is a deliberate cap: translation is free but **layout QA is
not** — each tier-1 locale gets one manual pass through the dense surfaces
(MoveGate, Profile, the standings sheet, the daily card) before the list grows.

## Rollout plan

1. **Foundation (no behavior change):** catalog + codegen + `t()`/`tJsx` +
   locale resolution + `lang` attribute + `language` setting + thread the app
   locale into existing `Intl` calls + close the formatting gaps (calendar
   months, relative time). Extract all ~300 strings into `en.json` with
   descriptions. English-only; the app renders byte-identically.
2. **Pipeline:** `i18n:check` + `i18n:translate` + the CI gate + the GitHub
   Action + glossary + pseudo-locale + the JSX lint rule.
3. **Launch tier 1:** generate the six non-English catalogs, QA pass per locale
   on the dense surfaces, ship the language picker, wire the explicit choice →
   `user.locale` update for push copy.
4. **Follow-ups:** server error codes, runtime `document.title`, tier 2 locales,
   the RTL audit, revisit privacy-policy translation.

Phases 1–2 are the real work and are language-agnostic; everything after is
turning a crank.
