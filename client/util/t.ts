// The client's message accessor: `t(key, params)` renders in the active UI
// locale. Wraps the pure common/i18n `t` with the `uiLocale` signal — reading it
// during render subscribes the component, so switching language re-renders live
// (no context provider). Until the language picker ships, `uiLocale` is undefined
// (the viewer's own locale → English copy with the viewer's number/date
// formatting), matching today's behaviour byte-for-byte.

import { signal } from "@preact/signals";
import {
  type MessageKey,
  type MessageParams,
  t as tBase,
} from "../../common/i18n.ts";

export const uiLocale = signal<string | undefined>(undefined);

export const t = <K extends MessageKey>(
  key: K,
  ...params: keyof MessageParams[K] extends never ? [] : [MessageParams[K]]
): string => tBase(uiLocale.value, key, ...params);
