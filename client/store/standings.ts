import { signal } from "@preact/signals";
import { api, MessageMap } from "../api.ts";
import { getTimeZone } from "../util/timeZone.ts";
import { keyedQuery } from "./query.ts";

export type StandingsData = MessageMap["standings"];

// Standings per iteration, folded in from every response — the dock/sheet
// follow whichever day is selected on the board, so past days keep their
// boards around while navigating. Today's is warmed on boot (the primed fetch
// in index.ts) and refreshed on attempt boundaries.
export const standingsByIteration = signal<ReadonlyMap<number, StandingsData>>(
  new Map(),
);

// The iteration the timezone ("today") fetch resolves to — how readers map
// the board's current iteration onto the entry above, and how the dock knows
// the viewed day IS today (which gates its reveal; see Dock.tsx).
export const todayIteration = signal<number | undefined>(undefined);

api.addEventListener("standings", (s) => {
  const next = new Map(standingsByIteration.value);
  next.set(s.iteration, s);
  standingsByIteration.value = next;
});

// However often components ask, at most one request per day per freshness
// window; a failed fetch frees the window so the next ask retries. Keyed by
// iteration, with null meaning "today" (resolved server-side from the
// timezone — the client doesn't know today's iteration id until it answers).
const fetchOnce = keyedQuery(async (iteration: number | null) => {
  const s = await (iteration == null
    ? api.standings({ timeZone: getTimeZone() })
    : api.standings({ iteration }));
  if (!s || "error" in s) {
    throw new Error("failed to fetch standings");
  }
  if (iteration == null) {
    todayIteration.value = s.iteration;
  }
  return s;
}, { staleMs: 30_000 });

// Fetch a day's standings (or serve the fresh cache); omit `iteration` for
// today. Errors are swallowed — readers keep showing whatever was folded in.
export const fetchStandings = (iteration?: number) =>
  fetchOnce(iteration ?? null).catch(() => undefined);

// Force-refresh at moments the board likely moved (your attempt just landed,
// the sheet is opening onto possibly-stale ranks).
export const refreshStandings = (iteration?: number) => {
  fetchOnce.bust(iteration ?? null);
  return fetchStandings(iteration);
};

// Attempt boundaries move your best on TODAY's board: a summary lands at boot
// and after the final attempt; a startRun begins the next attempt (the
// previous one's time is now settled). Past days are frozen — nothing to
// re-rank there.
api.addEventListener("getDailySummary", () => refreshStandings());
api.addEventListener("startRun", () => refreshStandings());
