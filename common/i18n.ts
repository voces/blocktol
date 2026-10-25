// The message-catalog runtime, shared by the server (push copy in the
// recipient's stored locale) and the client (UI copy in the viewer's locale).
//
// Messages are authored in `i18n/en.json` as ICU MessageFormat strings and
// compiled by `scripts/genI18n.ts` into `common/i18n.generated.ts` (gitignored
// build artifact): each is pre-parsed to the `I18nNode[]` AST below, so no ICU
// parser ships in the client bundle. The generated file also derives
// `MessageKey` and per-key param types from `en.json`, so a missing key or
// wrong argument is a compile error.
//
// `t(locale, key, params)` is pure; the client wraps it with its locale signal
// (see client/util/t.ts).

import { catalog, type Locale, locales } from "./i18n.generated.ts";
export type { Locale, MessageKey, MessageParams } from "./i18n.generated.ts";
// The runtime array of supported locales, for the language picker.
export { locales } from "./i18n.generated.ts";
import type { MessageKey, MessageParams } from "./i18n.generated.ts";

// One node of a compiled ICU message. A string is literal text; `{ arg }`
// substitutes a param; `pound` is the `#` in a plural branch (the count);
// `plural`/`select` hold branches keyed by CLDR category or `=N` (plural) or
// literal value (select), always including `other`.
export type I18nNode =
  | string
  | { arg: string }
  | { pound: true }
  | { arg: string; plural: Record<string, I18nNode[]> }
  | { arg: string; select: Record<string, I18nNode[]> };

export type I18nParams = Record<string, string | number>;

// Intl constructors are costly and copy renders in tight loops, so cache per
// locale. A malformed stored locale throws; fall back to the runtime default so
// one bad `user.locale` can't break push rendering (as in common/format.ts).
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

// Walk a compiled message. `pound` is the active plural count (renders `#`).
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

// Match a BCP-47 tag against catalog locales (exact tag, then language-only
// prefix), or undefined. Generic over the set so a separately compiled catalog
// (the server's privacy page) negotiates the same way.
export const matchLocale = <L extends string>(
  locale: string | undefined,
  available: readonly L[],
): L | undefined => {
  if (!locale) return undefined;
  let canon = locale;
  try {
    canon = Intl.getCanonicalLocales(locale)[0] ?? locale;
  } catch { /* malformed tag — fall through to the prefix match */ }
  const lower = canon.toLowerCase();
  for (const l of available) if (l.toLowerCase() === lower) return l;
  const lang = lower.split("-")[0];
  for (const l of available) {
    if (l.toLowerCase().split("-")[0] === lang) return l;
  }
  return undefined;
};

// Resolve a BCP-47 tag to a supported catalog locale: exact, then language
// prefix, then `en`. The full tag still drives Intl formatting, so `en-GB` gets
// `en` copy with British number conventions.
export const resolveCatalog = (locale: string | undefined): Locale =>
  matchLocale(locale, locales) ?? "en";

// A language's name in its own tongue ("Español", "日本語") for the picker,
// which must be readable by someone who can't read the current UI language.
// DisplayNames lowercases some (French, Spanish): uppercase the first letter.
const endonymCache = new Map<string, string>();
export const endonym = (tag: string): string => {
  let v = endonymCache.get(tag);
  if (v === undefined) {
    try {
      const name = new Intl.DisplayNames(tag, { type: "language" }).of(tag) ??
        tag;
      v = name.charAt(0).toUpperCase() + name.slice(1);
    } catch {
      v = tag;
    }
    endonymCache.set(tag, v);
  }
  return v;
};

// Resolve a key to its compiled AST in the best-matching catalog, falling back
// to English. Exposed so the client's `tJsx` (which substitutes VNodes for some
// args) can walk the same nodes.
export const messageNodes = (
  locale: string | undefined,
  key: MessageKey,
): readonly I18nNode[] => {
  const cat = resolveCatalog(locale);
  return catalog[cat][key] ?? catalog.en[key]!;
};

// Shared so `tJsx` formats numeric args as `renderMessage` does.
export const formatNumber = (locale: string | undefined, n: number): string =>
  numberFormat(locale).format(n);

/**
 * Render a catalog message. `locale` is a BCP-47 tag: omitted on the client,
 * the recipient's `user.locale` on the server for push copy. Key and params are
 * typed against `en.json`. A locale missing the key falls back to English.
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
