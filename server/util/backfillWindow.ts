const ONE_DAY = 1_000 * 60 * 60 * 24;

// Whether the on-demand backfill (`ensureDailyIterationId`) may generate a
// missing day. Pure so the window is unit-testable; all values are UTC-midnight
// epoch ms.
//
// - Upper bound: no later than tomorrow UTC — the cron's own look-ahead, and no
//   timezone is ever on a later local day — so a far-future deep link can't
//   force generation and leak a puzzle that isn't playable yet.
// - Lower bound: no earlier than the earliest iteration that exists (`floor`).
//   Every caller can name any date (`standings({year,month,day})`, a
//   `/YYYYMMDD` permalink), so without it a script looping back to year 1000
//   burns CPU generating boards, fills the table, and starves `rate-dailies`,
//   which rates the oldest unrated day first. A real gap is always newer than
//   the first day the game ran, so nothing legitimate falls below it. On an
//   empty table (a fresh dev DB) there is no floor yet, and yesterday UTC
//   stands in — the earliest local day any timezone can be on. Yesterday is
//   allowed even above an existing floor, so a fresh DB seeded only with today
//   can still serve players west of UTC.
export const backfillWindow = (
  target: number,
  floor: number | null,
  todayUtc: number,
): "ok" | "future" | "past" => {
  if (target > todayUtc + ONE_DAY) return "future";
  const lowest = Math.min(floor ?? Infinity, todayUtc - ONE_DAY);
  if (target < lowest) return "past";
  return "ok";
};

// A calendar date as UTC-midnight epoch ms, or null when it isn't one: NaN, a
// fraction, or an overflow like Feb 31 that Date.UTC would quietly roll into
// March (and newIteration would then generate under a different day than the
// one asked for).
export const utcDay = (year: number, month: number, day: number) => {
  const ms = Date.UTC(year, month - 1, day);
  const d = new Date(ms);
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 &&
      d.getUTCDate() === day
    ? ms
    : null;
};
