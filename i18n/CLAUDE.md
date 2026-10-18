# i18n/ — localization

Loaded when working under `i18n/`. The root `CLAUDE.md` covers the whole repo:
what the game is, commands, the import rule, and the domain invariants every
area relies on.

User-facing copy lives in **ICU MessageFormat catalogs** under `i18n/`, not
inline in code. `i18n/en.json` is the source of truth
(`{ key: { message,
description } }`); it defines the key set and, through the
ICU args, the params each message takes. `scripts/genI18n.ts` (the `i18n` task,
run first in `build`/`dev`/`test` and in CI before `deno check`) compiles every
`i18n/<locale>.json` into **`common/i18n.generated.ts`** — gitignored and
generated exactly like `common/version.ts`. The generated module pre-parses each
message to an `I18nNode[]` AST (so **no ICU parser ships in the client bundle**
— the parser is `scripts/i18nParse.ts`, build-only) and derives `MessageKey` + a
per-key `MessageParams` type map from `en.json`, so a missing key or wrong
argument at a `t(...)` call site is a **compile error** (the `BlocktolApi`
type-derivation move).

There is a **second catalog**, `i18n/privacy/` (`en.json` + a translation per
target), for the privacy page's prose. `CATALOGS` in `scripts/i18nLib.ts` lists
both; genI18n compiles each to its own module, and `i18n:check` /
`i18n:translate` / `i18n:unused` treat them alike (same targets, glossary, and
gate; the privacy one carries a translator `brief` for its register). It
compiles to the **server-only** `server/privacy/catalog.generated.ts` so a page
of prose doesn't ride along in every client bundle, and it's its own file so its
git history is exactly the page's (the page links it). The page renders it
through its own HTML walker (the server-side twin of `tJsx`) and borrows the app
catalog for labels that name in-app controls ("Export my data"), so it says
exactly what those buttons say.

`common/i18n.ts` is the one runtime, pure and framework-free so server and
client share it: `t(locale, key, params)` resolves the BCP-47 `locale` to a
supported catalog locale (exact tag → language prefix → `en`; the full tag still
drives `Intl` number/plural formatting) and walks the AST — `{arg}`
substitution, `{count, plural, …}` via `Intl.PluralRules` with `#`,
`{sel, select, …}`. `locale` is omitted on the client (viewer's own locale) and
set to the recipient's `user.locale` for server-rendered push copy — the same
convention `common/format.ts` already uses. A locale missing a key falls back to
the English AST. **Conventions:** keys are stable and namespaced by surface
(`notif.`, …), never encode the English text; **never interpolate a key** — map
an enum to its key with a literal object/ternary so every live key is greppable
(see `notificationText`). Rich-text copy — a message that wraps part of the
sentence in markup (a `<b>`, a link) — uses `tJsx` (`client/util/t.ts`), which
returns a `(string | VNode)[]` instead of a string: the catalog keeps one arg
per wrapped span (`"You beat {pct} of players today"` with `pct={<b>84%</b>}`)
so a locale can move the emphasis where its grammar wants; plain `t` covers
everything else. **User-facing piece names are `block` and `thunder`** — the
internal `bricks`/`power`/`slow` names never appear in copy (see
`i18n/glossary.json`, which the translator reads).

Adding/altering copy: edit `i18n/en.json`, run `deno task i18n` (or any
`build`/`dev`/`test`), and call `t(...)`. Remaining migration work is tracked in
`docs/localization.md`.

**Picking the language.** `settings.language` (`common/settings.ts`) holds the
choice — `"system"` (the default) or a BCP-47 tag; the tolerant parser keeps any
string (the catalog resolves an unsupported tag to English). `applyLanguage`
(`client/hooks/useSettings.ts`, run at `initSettings` boot and on every settings
change, mirroring `applyTheme`) points the `uiLocale` signal at the tag —
`"system"` resolves to `navigator.language`, so **an un-overridden user gets
their browser language**, falling back to English — and stamps
`document.documentElement.lang` with the resolved catalog locale. Because every
`t(...)` reads `uiLocale`, a switch re-renders live. Dates and numbers follow
the same choice, not the browser's locale: format a date with `intlLocale()`
(`client/util/t.ts` — `uiLocale`, read so the component re-renders, guarded
against a malformed tag), and `common/format.ts` takes the language as its
client-side default (`setDefaultLocale`, set by `applyLanguage`). The Profile →
Preferences picker is a native `<select>` of `locales` (endonyms via
`Intl.DisplayNames`) plus a System option. An **explicit** choice also rides to
the server (`setSettings` → `updateUserLocale`) so push copy — rendered in
`user.locale` — matches; `"system"` leaves `user.locale` as the browser tag
captured passively at push-subscribe, so the two stay in step.
