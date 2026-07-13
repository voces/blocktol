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

// Application-order guard (same rationale as the standings store): refreshMonth
// busts + refetches, so overlapping `list` responses could fold in LAND order
// and a slow stale one clobber a fresh month's cells, with nothing to
// re-correct it. Each write — a fetch OR an applyRun patch — takes a monotonic
// seq; a day only updates if no newer write for it already landed.
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

  // A local patch is the freshest word on this day at this moment — take the
  // newest seq so a stale in-flight `list` response can't overwrite it (and a
  // later authoritative fetch still wins).
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

// The `list` range for a month index (idx = year*12 + month0). Shared so the boot
// prime can key `list` under the exact input the current-month fetch sends (see
// client `primeBoot`).
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

// The current local month's index — the calendar's default month, and the one
// boot primes `list` for.
export const currentMonthIdx = () => {
  const d = new Date();
  return d.getFullYear() * 12 + d.getMonth();
};

// Fetch a month of dailies (idx = year*12 + month0) once — repeat calls are
// free — via the range API. A failed fetch frees the month and retries
// shortly (e.g. after a brief disconnect on cold load).
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

// How fresh a month must be for refreshMonth to leave it alone (see below).
const FRESH_REFRESH_MS = 4_000;

// Drop a month's dedupe entry and refetch it — for when its data is known to
// be incomplete (a brand-new user's current-month fetch can land before their
// first run is recorded; see Calendar).
//
// boot seeds the current month, and the calendar's post-summary effect fires
// refreshMonth(current) the moment attemptsRemaining resolves to 0 — a redundant
// refetch right after boot. Skip the bust while the month is this fresh (any run
// at boot is already recorded, so boot's month is accurate); a genuine
// mid-session refresh is well outside the window and still busts + refetches.
export const refreshMonth = (idx: number) => {
  if (monthOnce.age(idx) > FRESH_REFRESH_MS) monthOnce.bust(idx);
  ensureMonth(idx);
};
