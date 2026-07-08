import { signal } from "@preact/signals";
import { api, MessageMap } from "../api.ts";
import { getTimeZone } from "../util/timeZone.ts";
import { keyedQuery } from "./query.ts";

export type StandingsData = MessageMap["standings"];

// Today's standings — the dock sliver and its expanded sheet both read this.
// Warmed on boot (the primed fetch in index.ts) and refreshed on attempt
// boundaries; otherwise served for its freshness window.
export const standings = signal<StandingsData | undefined>(undefined);

// However often components ask, at most one request per freshness window; a
// failed fetch frees the window so the next ask retries.
const fetchOnce = keyedQuery(async () => {
  const s = await api.standings({ timeZone: getTimeZone() });
  if (!s || "error" in s) throw new Error("failed to fetch standings");
  standings.value = s;
  return s;
}, { staleMs: 30_000 });

// Fetch (or serve the fresh cache). Errors are swallowed — callers keep
// showing whatever was cached.
export const fetchStandings = (): Promise<StandingsData | undefined> =>
  fetchOnce(undefined).catch(() => standings.peek());

// Force-refresh at moments the board likely moved (your attempt just landed,
// the sheet is opening onto possibly-stale ranks).
export const refreshStandings = () => {
  fetchOnce.bust(undefined);
  return fetchStandings();
};

// Attempt boundaries move your best: a summary lands at boot and after the
// final attempt; a startRun begins the next attempt (the previous one's time
// is now settled). Both are cheap signals to re-rank on.
api.addEventListener("getDailySummary", () => refreshStandings());
api.addEventListener("startRun", () => refreshStandings());
