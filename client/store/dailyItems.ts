import { signal } from "@preact/signals";
import { api, type MessageMap } from "../api.ts";
import { keyedQuery } from "./query.ts";

export type DailyItem = MessageMap["list"]["items"][number];
type Attempt = MessageMap["getDailySummary"]["attempts"][number];

// The daily list, keyed by iteration and accumulated across paged `list`
// fetches, so paging back never drops loaded months.
export const dailyItems = signal<ReadonlyMap<number, DailyItem>>(new Map());

// The first daily's date (paging floor), from the server.
export const oldestDaily = signal<[number, number, number] | undefined>(
  undefined,
);

// Application-order guard (as in the standings store): refreshMonth busts and
// refetches, so overlapping `list` responses could fold in LAND order and let a
// slow stale one clobber fresh cells. Each write, a fetch OR an applyRun patch,
// takes a monotonic seq; a day updates only if no newer write already landed.
let fetchSeq = 0;
const appliedSeq = new Map<number, number>();

const foldMonth = (items: readonly DailyItem[], seq: number) => {
  const next = new Map(dailyItems.value);
  let changed = false;
  for (const item of items) {
    if ((appliedSeq.get(item.iteration) ?? 0) > seq) continue;
    appliedSeq.set(item.iteration, seq);
    next.set(item.iteration, item);
    changed = true;
  }
  if (changed) dailyItems.value = next;
};

// Patch a day's item from a run's fresh attempts, so finishing a run updates
// the calendar and today panels without refetching the list.
export const applyRun = (iteration: number, attempts: readonly Attempt[]) => {
  // Empty attempts would wrongly null a day whose runs haven't loaded.
  if (!attempts.length) return;
  const existing = dailyItems.value.get(iteration);
  // An unloaded month is correct when next fetched.
  if (!existing) return;

  const ownBest = Math.max(...attempts.map((a) => a.duration));
  const ranked = attempts.filter((a) => a.ranked);
  const bestRanked = ranked.length
    ? ranked.reduce((a, b) => (b.duration > a.duration ? b : a))
    : null;
  const best = attempts.reduce((a, b) => (b.duration > a.duration ? b : a));

  // Take the newest seq so a stale in-flight `list` response can't overwrite
  // this patch; a later fetch still wins.
  appliedSeq.set(iteration, ++fetchSeq);
  const next = new Map(dailyItems.value);
  next.set(iteration, {
    ...existing,
    ownBest,
    ownDailyBest: bestRanked ? bestRanked.duration : existing.ownDailyBest,
    best: Math.max(existing.best ?? ownBest, ownBest),
    dailyBest: bestRanked
      ? Math.max(
        existing.dailyBest ?? bestRanked.duration,
        bestRanked.duration,
      )
      : existing.dailyBest,
    supreme: best.supreme,
    dailyPercentile: typeof bestRanked?.percentile === "number"
      ? bestRanked.percentile
      : existing.dailyPercentile,
  });
  dailyItems.value = next;
};

// The `list` range for a month index (idx = year*12 + month0). Shared so
// api.primeBoot keys `list` under the input the month fetch sends.
export const monthListInput = (
  idx: number,
): Parameters<typeof api.list>[0] => {
  const y = Math.floor(idx / 12);
  const m0 = idx % 12;
  const next = idx + 1;
  return {
    start: [y, m0 + 1, 1],
    end: [Math.floor(next / 12), (next % 12) + 1, 1],
  };
};

// The current local month's index: the calendar's default, primed at boot.
export const currentMonthIdx = () => {
  const d = new Date();
  return d.getFullYear() * 12 + d.getMonth();
};

// Fetch a month of dailies (idx = year*12 + month0) once; repeat calls are
// free. A failed fetch frees the month and ensureMonth retries shortly.
const monthOnce = keyedQuery(async (idx: number) => {
  const seq = ++fetchSeq;
  const r = await api.list(monthListInput(idx));
  if ("error" in r) throw new Error("failed to list month");
  if (r.oldest) oldestDaily.value = r.oldest;
  foldMonth(r.items, seq);
  return r;
});

export const ensureMonth = (idx: number) => {
  if (idx < 0) return;
  monthOnce(idx).catch(() => setTimeout(() => ensureMonth(idx), 1500));
};

// How fresh a month must be for refreshMonth to leave it alone.
const FRESH_REFRESH_MS = 4_000;

// Drop a month's dedupe entry and refetch it, for when its data is known to be
// incomplete (a new user's current-month fetch can land before their first run
// is recorded; see Calendar).
//
// The bust is skipped while the month is fresh: boot seeds the current month,
// and the calendar's post-summary effect calls refreshMonth(current) right
// after, which would be a redundant refetch.
export const refreshMonth = (idx: number) => {
  if (monthOnce.age(idx) > FRESH_REFRESH_MS) monthOnce.bust(idx);
  ensureMonth(idx);
};
