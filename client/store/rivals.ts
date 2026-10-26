import { signal } from "@preact/signals";
import { api, type MessageMap } from "../api.ts";
import { keyedQuery } from "./query.ts";

export type RivalList = MessageMap["rivals"];

// Every head-to-head record the player has. Unlike the profile (which rides on
// boot), this is fetched when the sheet behind the profile's short list opens.
export const rivals = signal<RivalList | undefined>(undefined);

const fetchOnce = keyedQuery(async () => {
  const r = await api.rivals({});
  if ("error" in r) throw new Error("failed to fetch rivals");
  rivals.value = r;
  return r;
}, { staleMs: 20_000 });

// Fetch, or serve the fresh cache. Errors are swallowed; the sheet keeps what
// it has.
export const fetchRivals = (): Promise<RivalList | undefined> =>
  fetchOnce(undefined).catch(() => rivals.peek());
