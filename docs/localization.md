# Localization — status

**Shipped and live.** Every user-facing surface renders through the ICU message
catalog, and the language picker (Profile → Preferences) selects among the
supported locales. Architecture lives in code and in CLAUDE.md → _Localization
(i18n)_; this file is just the residual-work tracker.

Goals met: every user-facing word flows through one catalog (client copy, in-app
notification copy, server push copy alike); untranslated functionality can't
deploy (CI `i18n:check`, not discipline); `Intl.*` for number/date/plural
formatting; one engine, no per-surface divergence.

## Done

- **Catalog + codegen + typed runtime** — `i18n/en.json` → `scripts/genI18n.ts`
  → `common/i18n.generated.ts` (pre-parsed AST + derived `MessageKey`/
  `MessageParams`); `common/i18n.ts` is the pure `t`; `client/util/t.ts` wraps
  it with the `uiLocale` signal (live switch) and adds `tJsx` for embedded
  markup.
- **All copy migrated** — every client surface (game HUD, board cards,
  standings, runs, calendar, profile, account move/delete sheets, notifications
  panel, the onboarding tutorial, and the MoveGate account-fork gate) plus
  notification copy (in-app + server push). ~227 keys.
- **Formatting gaps closed** — `Intl.DateTimeFormat` for calendar month/weekday
  names; the relative-time / countdown helpers and every plural (`runs`,
  `players`, `unread`, `best of N`) go through catalog messages
  (`{n, plural, …}` / `time.*`), so no hand-rolled English plural or month array
  remains.
- **The language picker** — `settings.language` (`"system"` default → browser
  locale) + zod; a custom Profile dropdown of locale endonyms; wires
  `uiLocale` + `document.documentElement.lang`; an explicit choice also updates
  `user.locale` so push copy matches. See CLAUDE.md.
- **The pipeline** — `i18n:check` (gate: missing/stale/orphaned +
  ICU/placeholder/ plural-coverage validation), `i18n:translate` (Anthropic
  auto-fixer behind a `Translator` seam), `i18n:unused` (dead-key gate), and the
  Translate GitHub Action (edit `en.json`, push, the PR translates itself). Six
  launch locales: `es`, `pt-BR`, `fr`, `de`, `ja`, `zh-Hans`.

## Remaining polish (optional, non-blocking)

- **JSX-leak lint plugin** — a Deno lint rule flagging hardcoded JSX text /
  user-facing props (`aria-label`, `title`, …) outside an allowlist, so a
  _future_ untranslated string is caught mechanically rather than by review.
- **`en-XA` pseudo-locale** — dev-only mechanical accents + length padding to
  surface truncation/overflow before a real locale does.
- **Per-locale bundle split** — today every catalog compiles into the main
  bundle; split each to `public/js/i18n/<locale>.js`, dynamically imported when
  active (the `pathing.js` precedent), so the bundle doesn't grow with locale
  count. Perf only; irrelevant at six locales.
- **Server `UserError` → codes** — the few `UserError` strings ("no daily for
  that date", "invalid timeZone", auth) are still English; make them stable
  codes the client maps through the catalog. Low volume, rarely surfaced.
- **`Intl.RelativeTimeFormat`** — relative time currently uses compact catalog
  strings ("5m ago") so English stays byte-identical and translators localize
  the unit; switching to `Intl.RelativeTimeFormat` would drop the catalog keys
  but change the wording ("5 min. ago"). A copy decision, not a bug.
- **Runtime `document.title`, tier-2 locales (`ko`/`it`/`pl`/`nl`/`tr`/`ru`),
  RTL audit (`ar`/`he`)** — each tier-1 locale wants one manual layout QA pass
  through the dense surfaces (MoveGate, Profile, standings sheet, daily card)
  before the list grows.

## Deliberately English (unchanged)

Discord posts (shared community channel), `public/privacy.html` (legal),
install-time/SEO metadata in the static shell, the board (no text). The `DELETE`
confirm sentinel **is** localized (glossary-pinned).
