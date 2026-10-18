const ONE_DAY = 1_000 * 60 * 60 * 24;

// Whether the on-demand backfill (`ensureDailyIterationId`) may generate a
// missing day. All values are UTC-midnight epoch ms.
//
// - Upper bound: tomorrow UTC, the cron's look-ahead (no timezone is ever
//   later), so a far-future deep link can't force generation and leak a puzzle.
// - Lower bound: the earliest existing iteration (`floor`). Callers can name
//   any date (`standings({year,month,day})`, a `/YYYYMMDD` permalink); without
//   a floor a script looping back to year 1000 fills the table with boards and
//   starves `rate-dailies`, which rates the oldest unrated day first. On an
//   empty table yesterday UTC (the earliest local day any timezone can be on)
//   stands in. Yesterday is allowed above an existing floor too, so a fresh DB
//   seeded only with today still serves players west of UTC.
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
// fraction, or an overflow like Feb 31 that Date.UTC would roll into March.
export const utcDay = (year: number, month: number, day: number) => {
  const ms = Date.UTC(year, month - 1, day);
  const d = new Date(ms);
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 &&
      d.getUTCDate() === day
    ? ms
    : null;
};
