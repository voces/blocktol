import { signal } from "@preact/signals";
import { api, MessageMap } from "../api.ts";
import { keyedQuery } from "./query.ts";

export type DailyItem = MessageMap["list"]["items"][number];
type Attempt = MessageMap["getDailySummary"]["attempts"][number];

// The daily list, keyed by iteration and accumulated across paged `list`
// fetches so paging back never drops already-loaded months. Components read
// `dailyItems.value` (calendar cells, the today panel) and re-render as
// months land or a finished run patches a day.
export const dailyItems = signal<ReadonlyMap<number, DailyItem>>(new Map());

// The first daily's date (paging floor), from the server.
export const oldestDaily = signal<[number, number, number] | undefined>(
  undefined,
);

// Every list response folds in, whoever requested it.
api.addEventListener("list", (d) => {
  if (d.oldest) oldestDaily.value = d.oldest;
  const next = new Map(dailyItems.value);
  for (const item of d.items) next.set(item.iteration, item);
  dailyItems.value = next;
});

// Patch a day's item in place from a run's fresh attempts — so finishing a run
// updates the calendar/today panels without a round trip to refetch the list.
export const applyRun = (iteration: number, attempts: readonly Attempt[]) => {
  // Empty attempts can't set anything authoritatively (they'd wrongly null a
  // day that simply hasn't loaded its runs yet) — the list fetch already has
  // the truth for those.
  if (!attempts.length) return;
  const existing = dailyItems.value.get(iteration);
  // Only patch a day we've actually loaded; an unloaded month will be correct
  // when it's next fetched.
  if (!existing) return;

  const ownBest = Math.max(...attempts.map((a) => a.duration));
  const ranked = attempts.filter((a) => a.ranked);
  const bestRanked = ranked.length
    ? ranked.reduce((a, b) => (b.duration > a.duration ? b : a))
    : null;
  const best = attempts.reduce((a, b) => (b.duration > a.duration ? b : a));

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

// Fetch a month of dailies (idx = year*12 + month0) once — repeat calls are
// free — via the range API. A failed fetch frees the month and retries
// shortly (e.g. after a brief disconnect on cold load).
const monthOnce = keyedQuery(async (idx: number) => {
  const y = Math.floor(idx / 12);
  const m0 = idx % 12;
  const next = idx + 1;
  const r = await api.list({
    start: [y, m0 + 1, 1],
    end: [Math.floor(next / 12), (next % 12) + 1, 1],
  });
  if ("error" in r) throw new Error("failed to list month");
  return r;
});

export const ensureMonth = (idx: number) => {
  if (idx < 0) return;
  monthOnce(idx).catch(() => setTimeout(() => ensureMonth(idx), 1500));
};

// Drop a month's dedupe entry and refetch it — for when its data is known to
// be incomplete (a brand-new user's current-month fetch can land before their
// first run is recorded; see Calendar).
export const refreshMonth = (idx: number) => {
  monthOnce.bust(idx);
  ensureMonth(idx);
};
