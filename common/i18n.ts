// The message-catalog runtime, shared by the server (push copy rendered in the
// recipient's stored locale) and the client (UI copy in the viewer's locale) —
// the same single-engine posture as the pathing solver and `common/format.ts`.
//
// Messages are authored in `i18n/en.json` as ICU MessageFormat strings and
// compiled by `scripts/genI18n.ts` into `common/i18n.generated.ts` (gitignored,
// a build artifact like `common/version.ts`): each message is pre-parsed to the
// `I18nNode[]` AST below, so NO ICU parser ships in the client bundle — this
// module only walks the AST. The generated file also derives `MessageKey` and a
// per-key params type map from `en.json`, so a missing key or a wrong argument
// is a compile error (the same type-derivation move as `BlocktolApi`).
//
// `t(locale, key, params)` is pure and framework-free so both sides call it
// directly; the client wraps it with its locale signal (see client/util/t.ts).

import { catalog, type Locale, locales } from "./i18n.generated.ts";
export type { Locale, MessageKey, MessageParams } from "./i18n.generated.ts";
import type { MessageKey, MessageParams } from "./i18n.generated.ts";

// One node of a compiled ICU message. A plain string is literal text; `{ arg }`
// substitutes a param; `pound` is the `#` inside a plural branch (the count);
// `plural`/`select` hold their branch sub-messages keyed by CLDR category /
// `=N` (plural) or literal value (select), always including `other`.
export type I18nNode =
  | string
  | { arg: string }
  | { pound: true }
  | { arg: string; plural: Record<string, I18nNode[]> }
  | { arg: string; select: Record<string, I18nNode[]> };

export type I18nParams = Record<string, string | number>;

// Intl constructors aren't free and copy renders in tight loops (the board's
// time column, the standings sheet), so cache per locale. A malformed stored
// locale would throw, so fall back to the runtime default rather than let one
// bad `user.locale` break push rendering — mirroring common/format.ts.
const nfCache = new Map<string, Intl.NumberFormat>();
const numberFormat = (locale: string | undefined): Intl.NumberFormat => {
  const key = locale ?? "";
  let f = nfCache.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(locale);
    } catch {
      f = new Intl.NumberFormat(undefined);
    }
    nfCache.set(key, f);
  }
  return f;
};

const prCache = new Map<string, Intl.PluralRules>();
const pluralRules = (locale: string | undefined): Intl.PluralRules => {
  const key = locale ?? "";
  let r = prCache.get(key);
  if (!r) {
    try {
      r = new Intl.PluralRules(locale);
    } catch {
      r = new Intl.PluralRules(undefined);
    }
    prCache.set(key, r);
  }
  return r;
};

// Walk a compiled message. `pound` carries the active plural count so a nested
// `#` renders the (locale-formatted) number.
export const renderMessage = (
  nodes: readonly I18nNode[],
  locale: string | undefined,
  params: I18nParams,
  pound?: number,
): string => {
  let out = "";
  for (const node of nodes) {
    if (typeof node === "string") {
      out += node;
    } else if ("pound" in node) {
      out += pound === undefined ? "" : numberFormat(locale).format(pound);
    } else if ("plural" in node) {
      const n = Number(params[node.arg]);
      const branch = node.plural["=" + n] ??
        node.plural[pluralRules(locale).select(n)] ??
        node.plural.other ?? [];
      out += renderMessage(branch, locale, params, n);
    } else if ("select" in node) {
      const branch = node.select[String(params[node.arg])] ??
        node.select.other ?? [];
      out += renderMessage(branch, locale, params, pound);
    } else {
      const v = params[node.arg];
      out += typeof v === "number"
        ? numberFormat(locale).format(v)
        : v == null
        ? ""
        : String(v);
    }
  }
  return out;
};

// Resolve any BCP-47 tag (a viewer's runtime locale, a stored `user.locale`) to
// a supported catalog locale — exact tag, then language-only prefix, then `en`.
// The full tag still drives Intl formatting inside the message, so an `en-GB`
// viewer gets `en` copy with British number/date conventions for free.
export const resolveCatalog = (locale: string | undefined): Locale => {
  if (!locale) return "en";
  let canon = locale;
  try {
    canon = Intl.getCanonicalLocales(locale)[0] ?? locale;
  } catch { /* malformed tag — fall through to prefix / en */ }
  const lower = canon.toLowerCase();
  for (const l of locales) if (l.toLowerCase() === lower) return l;
  const lang = lower.split("-")[0];
  for (const l of locales) if (l.toLowerCase().split("-")[0] === lang) return l;
  return "en";
};

// Resolve a key to its compiled AST in the best-matching catalog, falling back
// to English. Exposed so a framework-aware renderer (the client's `tJsx`, which
// substitutes VNodes for some args) can walk the same nodes without re-resolving
// the catalog or shipping the parser.
export const messageNodes = (
  locale: string | undefined,
  key: MessageKey,
): readonly I18nNode[] => {
  const cat = resolveCatalog(locale);
  return catalog[cat][key] ?? catalog.en[key];
};

// Locale-aware number formatting, shared so `tJsx` formats numeric args exactly
// as `renderMessage` does.
export const formatNumber = (locale: string | undefined, n: number): string =>
  numberFormat(locale).format(n);

/**
 * Render a catalog message. `locale` is a BCP-47 tag — omitted on the client
 * (renders in the viewer's own locale), set on the server to the recipient's
 * `user.locale` for push copy. The key and params are typed against `en.json`,
 * so this call site can't drift from the catalog. A locale missing the key
 * falls back to the English message rather than rendering nothing.
 */
export const t = <K extends MessageKey>(
  locale: string | undefined,
  key: K,
  // Required for keys with arguments; omittable for no-argument keys.
  ...params: keyof MessageParams[K] extends never ? [] : [MessageParams[K]]
): string =>
  renderMessage(
    messageNodes(locale, key),
    locale,
    (params[0] ?? {}) as I18nParams,
  );
