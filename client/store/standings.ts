import { signal } from "@preact/signals";
import { api, type MessageMap } from "../api.ts";
import { getTimeZone } from "../util/timeZone.ts";
import { storage } from "../util/storage.ts";
import { keyedQuery } from "./query.ts";

export type StandingsData = MessageMap["standings"];
export type StandingsSort = "daily" | "pb";

// Standings keyed by iteration, folded in from every response; the dock and
// sheet follow the day selected on the board. Each response carries BOTH boards
// (daily + PB), so toggling the sort needs no refetch. Today's board is warmed
// on boot (primeSession in boot.ts) and refreshed on attempt boundaries.
export const standingsByKey = signal<ReadonlyMap<number, StandingsData>>(
  new Map(),
);

// Application-order guard. refreshStandings busts the cache and refetches, so
// OVERLAPPING fetches can be in flight (a commit, the dock revealing and a
// notification regrade can all fire at once). Folding in LAND order would let a
// slow older fetch clobber a newer one with stale ranks, and there's no
// standings poll to correct it. Each fetch takes a monotonic seq and folds only
// if no newer fetch for that iteration already has, so the latest-STARTED
// request wins.
let fetchSeq = 0;
const appliedSeq = new Map<number, number>();

const fold = (s: StandingsData, seq: number) => {
  if ((appliedSeq.get(s.iteration) ?? 0) > seq) return;
  appliedSeq.set(s.iteration, seq);
  const next = new Map(standingsByKey.value);
  next.set(s.iteration, s);
  standingsByKey.value = next;
};

// The iteration the timezone ("today") fetch resolves to. The dock compares the
// viewed day against it to know it IS today (which gates its reveal; see
// Dock.tsx).
export const todayIteration = signal<number | undefined>(undefined);

// The chosen sort, shared by the dock and sheet and persisted across visits.
// Pure display state: it selects a board from a fetched response, never a
// fetch.
const SORT_KEY = "standingsSort";
export const standingsSort = signal<StandingsSort>(
  storage.getItem(SORT_KEY) === "pb" ? "pb" : "daily",
);
export const setStandingsSort = (sort: StandingsSort) => {
  storage.setItem(SORT_KEY, sort);
  standingsSort.value = sort;
};

// Pick the active board off a response (both are always present).
export const boardOf = (
  data: StandingsData | undefined,
  sort: StandingsSort,
) => (sort === "pb" ? data?.pb : data?.daily);

// The sort to DISPLAY. A persisted "daily" falls back to the PB board when the
// day has no ranked runs, since PB counts free play and still has a field. A
// display override only: it never writes standingsSort, so the view flips back
// to daily once a ranked run lands. Unloaded data (undefined) keeps the sort.
export const effectiveSort = (
  data: StandingsData | undefined,
  sort: StandingsSort,
): StandingsSort =>
  sort === "daily" && data?.daily.rows.length === 0 ? "pb" : sort;

// A request (from a notification) to open the standings sheet for a day.
// `iteration` undefined means today; null means no pending request. The dock
// watches this, opens onto the matching day once its board is shown, and clears
// it.
export const openStandingsRequest = signal<
  { iteration?: number | undefined } | null
>(
  null,
);
export const requestStandings = (iteration?: number) => {
  openStandingsRequest.value = { iteration };
};

// The query key: the iteration, or "today" (the server resolves it from the
// timezone; the client doesn't know today's id until it answers).
const qkey = (iteration: number | undefined) => `${iteration ?? "today"}`;

// At most one request per day per freshness window; a failed fetch frees the
// window. Folds its own response (seq-guarded) rather than via a broadcast
// listener, so ordering holds.
const fetchOnce = keyedQuery(async (qk: string) => {
  const seq = ++fetchSeq;
  const iteration = qk === "today" ? undefined : Number(qk);
  const s = await (iteration == null
    ? api.standings({ timeZone: getTimeZone() })
    : api.standings({ iteration }));
  if ("error" in s) {
    throw new Error("failed to fetch standings");
  }
  if (iteration == null) {
    todayIteration.value = s.iteration;
  }
  fold(s, seq);
  return s;
}, { staleMs: 30_000 });

// Resolve a day's standings by calendar date (a /YYYYMMDD deep-link knows the
// date, not the id), folded with the same ordering guard. The caller navigates
// by the returned `iteration`.
export const fetchStandingsForDate = async (
  year: number,
  month: number,
  day: number,
): Promise<StandingsData | undefined> => {
  const seq = ++fetchSeq;
  const s = await api.standings({ year, month, day }).catch(() => undefined);
  if (!s || "error" in s) return undefined;
  fold(s, seq);
  return s;
};

// Fetch a day's standings, or serve the fresh cache; omit `iteration` for
// today. Errors are swallowed; readers keep what was folded in.
export const fetchStandings = (iteration?: number) =>
  fetchOnce(qkey(iteration)).catch(() => undefined);

// Boot seeds today's standings and the getDailySummary event then calls
// refreshStandings, which would be a redundant refetch. The bust is skipped
// while the cache is this fresh.
const FRESH_REFRESH_MS = 4_000;

// Force a refresh when the board likely moved (your attempt landed, or the
// sheet is opening onto possibly-stale ranks).
export const refreshStandings = (iteration?: number) => {
  if (fetchOnce.age(qkey(iteration)) > FRESH_REFRESH_MS) {
    fetchOnce.bust(qkey(iteration));
  }
  return fetchStandings(iteration);
};

// Two moments move a viewer's own standing:
//   - getDailySummary: a daily attempt settled. It lands at boot and after the
//     final attempt, and refreshes today's board.
//   - commitRun: a FREE-PLAY run became non-void and entered the field, which
//     can change the PB board. startRun is the wrong signal (the run is still
//     void). The response carries its iteration, so a past day refreshes too.
const refreshToday = () => void refreshStandings(undefined);
api.addEventListener("getDailySummary", refreshToday);
api.addEventListener("commitRun", (r) => {
  void refreshStandings(
    r.iteration === todayIteration.value ? undefined : r.iteration,
  );
});
