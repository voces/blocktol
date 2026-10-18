// The client's message accessor: `t(key, params)` renders in the active UI
// locale. Wraps the pure common/i18n `t` with the `uiLocale` signal — reading it
// during render subscribes the component, so switching language re-renders live
// (no context provider). Until the language picker ships, `uiLocale` is undefined
// (the viewer's own locale → English copy with the viewer's number/date
// formatting), matching today's behaviour byte-for-byte.

import { signal } from "@preact/signals";
import type { VNode } from "preact";
import {
  formatNumber,
  type I18nParams,
  type MessageKey,
  messageNodes,
  type MessageParams,
  renderMessage,
  t as tBase,
} from "../../common/i18n.ts";

export const uiLocale = signal<string | undefined>(undefined);

// The locale to hand `Intl` for dates: the chosen UI language, not the
// browser's. Reading it in render subscribes the component like `t` does, so a
// language switch re-renders the date. A malformed stored tag would make Intl
// throw mid-render, so it falls back to the browser's locale instead.
export const intlLocale = (): string | undefined => {
  const l = uiLocale.value;
  if (!l) return undefined;
  try {
    return Intl.getCanonicalLocales(l)[0];
  } catch {
    return undefined;
  }
};

export const t = <K extends MessageKey>(
  key: K,
  ...params: keyof MessageParams[K] extends never ? [] : [MessageParams[K]]
): string => tBase(uiLocale.value, key, ...params);

// Rich-text form of `t`: any arg may be a VNode (a `<b>`, a link, an icon), so
// the result is a `(string | VNode)[]` Preact can render inline rather than a
// flat string. Use it — sparingly — for the few messages that wrap part of the
// sentence in markup; plain `t` covers everything else. The catalog message
// stays translator-friendly (one arg per wrapped span, e.g. "You beat {pct} of
// players today" with `pct={<b>84%</b>}`), so a locale can move the emphasis
// where its grammar wants it. Params are typed against `en.json` exactly like
// `t`, just widened to accept a VNode wherever a string/number is expected.
type JsxParams<K extends MessageKey> = {
  [P in keyof MessageParams[K]]: MessageParams[K][P] | VNode;
};

export const tJsx = <K extends MessageKey>(
  key: K,
  ...params: keyof MessageParams[K] extends never ? [] : [JsxParams<K>]
): (string | VNode)[] => {
  const locale = uiLocale.value;
  const values = (params[0] ?? {}) as Record<string, string | number | VNode>;
  const out: (string | VNode)[] = [];
  for (const node of messageNodes(locale, key)) {
    if (typeof node === "string") {
      out.push(node);
    } else if ("plural" in node || "select" in node) {
      // A plural/select subtree resolves to plain text (its selector is a
      // number/enum, never a VNode) — delegate the whole node to the string
      // renderer and splice the result in.
      out.push(renderMessage([node], locale, values as I18nParams));
    } else if ("pound" in node) {
      // `#` only occurs inside a plural branch, handled above; a stray one has
      // no active count, so it renders nothing (matches renderMessage).
    } else {
      const v = values[node.arg];
      if (v == null) continue;
      out.push(typeof v === "number" ? formatNumber(locale, v) : v);
    }
  }
  return out;
};
