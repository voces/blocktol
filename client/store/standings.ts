import { signal } from "@preact/signals";
import { api, MessageMap } from "../api.ts";
import { getTimeZone } from "../util/timeZone.ts";
import { keyedQuery } from "./query.ts";

export type StandingsData = MessageMap["standings"];
export type StandingsSort = "daily" | "pb";

// Standings keyed by `${iteration}:${sort}`, folded in from every response —
// the dock/sheet follow whichever day is selected on the board (so past days
// keep their boards around while navigating), and the sheet toggles between the
// daily and all-time-PB sorts. Today's daily board is warmed on boot (the
// primed fetch in index.ts) and refreshed on attempt boundaries.
export const standingsByKey = signal<ReadonlyMap<string, StandingsData>>(
  new Map(),
);

// The iteration the timezone ("today") fetch resolves to — how readers map the
// board's current iteration onto an entry, and how the dock knows the viewed
// day IS today (which gates its reveal; see Dock.tsx).
export const todayIteration = signal<number | undefined>(undefined);

export const standingsKey = (iteration: number, sort: StandingsSort) =>
  `${iteration}:${sort}`;

// The chosen sort, shared by the dock and sheet and persisted across visits
// (like the runs panel's sort) — so toggling in the sheet sticks, and the
// collapsed dock reflects whichever board is active.
const SORT_KEY = "standingsSort";
export const standingsSort = signal<StandingsSort>(
  localStorage.getItem(SORT_KEY) === "pb" ? "pb" : "daily",
);
export const setStandingsSort = (sort: StandingsSort) => {
  localStorage.setItem(SORT_KEY, sort);
  standingsSort.value = sort;
};

api.addEventListener("standings", (s) => {
  const next = new Map(standingsByKey.value);
  next.set(`${s.iteration}:${s.sort}`, s);
  standingsByKey.value = next;
});

// The dedupe/query key: iteration (or "today", resolved server-side from the
// timezone — the client doesn't know today's id until it answers) plus sort.
const qkey = (iteration: number | undefined, sort: StandingsSort) =>
  `${iteration ?? "today"}:${sort}`;

// However often components ask, at most one request per key per freshness
// window; a failed fetch frees the window so the next ask retries.
const fetchOnce = keyedQuery(async (qk: string) => {
  const [itPart, sort] = qk.split(":") as [string, StandingsSort];
  const iteration = itPart === "today" ? undefined : Number(itPart);
  const s = await (iteration == null
    ? api.standings({ timeZone: getTimeZone(), sort })
    : api.standings({ iteration, sort }));
  if (!s || "error" in s) {
    throw new Error("failed to fetch standings");
  }
  if (iteration == null) {
    todayIteration.value = s.iteration;
  }
  return s;
}, { staleMs: 30_000 });

// Fetch a (day, sort)'s standings (or serve the fresh cache); omit `iteration`
// for today. Errors are swallowed — readers keep showing whatever was folded
// in.
export const fetchStandings = (
  iteration?: number,
  sort: StandingsSort = "daily",
) => fetchOnce(qkey(iteration, sort)).catch(() => undefined);

// Force-refresh at moments the board likely moved (your attempt just landed,
// the sheet is opening onto possibly-stale ranks).
export const refreshStandings = (
  iteration?: number,
  sort: StandingsSort = "daily",
) => {
  fetchOnce.bust(qkey(iteration, sort));
  return fetchStandings(iteration, sort);
};

// Attempt boundaries move your best on TODAY's boards: a summary lands at boot
// and after the final attempt; a startRun begins the next attempt (the previous
// one's time is now settled). Refresh the daily board (what the dock shows) and
// drop today's PB entry so a later PB view refetches. Past days are frozen —
// nothing to re-rank there.
const refreshToday = () => {
  refreshStandings(undefined, "daily");
  fetchOnce.bust(qkey(undefined, "pb"));
};
api.addEventListener("getDailySummary", refreshToday);
api.addEventListener("startRun", refreshToday);
