import { signal } from "@preact/signals";
import { api, MessageMap } from "../api.ts";
import { getTimeZone } from "../util/timeZone.ts";
import { keyedQuery } from "./query.ts";

export type StandingsData = MessageMap["standings"];
export type StandingsSort = "daily" | "pb";

// Standings keyed by iteration, folded in from every response — the dock/sheet
// follow whichever day is selected on the board (so past days keep their boards
// around while navigating). Each response carries BOTH boards (daily + PB), so
// toggling the sort is a pure client switch — no refetch. Today's board is
// warmed on boot (the primed fetch in index.ts) and refreshed on attempt
// boundaries.
export const standingsByKey = signal<ReadonlyMap<number, StandingsData>>(
  new Map(),
);

// The iteration the timezone ("today") fetch resolves to — how readers map the
// board's current iteration onto an entry, and how the dock knows the viewed
// day IS today (which gates its reveal; see Dock.tsx).
export const todayIteration = signal<number | undefined>(undefined);

// The chosen sort, shared by the dock and sheet and persisted across visits
// (like the runs panel's sort) — so toggling in the sheet sticks, and the
// collapsed dock reflects whichever board is active. Pure display state: it
// selects a board from an already-fetched response, never triggers a fetch.
const SORT_KEY = "standingsSort";
export const standingsSort = signal<StandingsSort>(
  localStorage.getItem(SORT_KEY) === "pb" ? "pb" : "daily",
);
export const setStandingsSort = (sort: StandingsSort) => {
  localStorage.setItem(SORT_KEY, sort);
  standingsSort.value = sort;
};

// Pick the active board off a response (both are always present).
export const boardOf = (
  data: StandingsData | undefined,
  sort: StandingsSort,
) => (sort === "pb" ? data?.pb : data?.daily);

// A request (from a notification) to open the standings sheet for a given day.
// `iteration` undefined means today; null means no pending request. The dock
// watches this, opens onto the matching day once its board is shown, and clears
// it. Kept in the store so a notification click (in the header) can reach the
// dock (down in the game tree) without prop-drilling.
export const openStandingsRequest = signal<{ iteration?: number } | null>(null);
export const requestStandings = (iteration?: number) => {
  openStandingsRequest.value = { iteration };
};

api.addEventListener("standings", (s) => {
  const next = new Map(standingsByKey.value);
  next.set(s.iteration, s);
  standingsByKey.value = next;
});

// The dedupe/query key: the iteration, or "today" (resolved server-side from
// the timezone — the client doesn't know today's id until it answers).
const qkey = (iteration: number | undefined) => `${iteration ?? "today"}`;

// However often components ask, at most one request per day per freshness
// window; a failed fetch frees the window so the next ask retries.
const fetchOnce = keyedQuery(async (qk: string) => {
  const iteration = qk === "today" ? undefined : Number(qk);
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
// today. Both boards come back in one response. Errors are swallowed — readers
// keep showing whatever was folded in.
export const fetchStandings = (iteration?: number) =>
  fetchOnce(qkey(iteration)).catch(() => undefined);

// Force-refresh at moments the board likely moved (your attempt just landed,
// the sheet is opening onto possibly-stale ranks).
export const refreshStandings = (iteration?: number) => {
  fetchOnce.bust(qkey(iteration));
  return fetchStandings(iteration);
};

// Two moments move a viewer's own standing:
//   - getDailySummary — a daily attempt settled (dailies commit on build); this
//     lands at boot and after the final attempt, refreshing today's board.
//   - commitRun — a FREE-PLAY run just became non-void and entered the field,
//     which can change the PB board (and your rank on it). It fires while the
//     run is still void at startRun, so startRun was the wrong signal; commit is
//     the moment it counts. The response carries its iteration, so a free-played
//     PAST day refreshes itself, not just today.
const refreshToday = () => refreshStandings(undefined);
api.addEventListener("getDailySummary", refreshToday);
api.addEventListener("commitRun", (r) => {
  refreshStandings(
    r.iteration === todayIteration.value ? undefined : r.iteration,
  );
});
