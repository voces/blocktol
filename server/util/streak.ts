// Consecutive-day streaks over the dates a player has a ranked result on.
//
// Pure and date-string based (`YYYY-MM-DD`, an iteration's own `created` DATE),
// so it never touches a timezone: a daily belongs to a calendar date, and the
// player's attempts on it were made inside their own local day (see the
// `ranked` flag). Parsing each date at UTC midnight only turns it into a day
// number for the gap arithmetic; no local clock is involved.

const DAY = 86_400_000;

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY;

// Longest and current runs of consecutive days in `dates` (any order,
// duplicates fine). The current run is the one ending today or yesterday —
// yesterday counts because the player's local day may still be running when the
// server's has rolled over, and a streak shouldn't break while they can still
// play (the reverse, a day early, needs no special case: a date ahead of the
// server's `today` is simply the run's newest day).
export const streaks = (dates: readonly string[], today: string) => {
  const days = [...new Set(dates)].map(dayNumber).sort((a, b) => a - b);
  const now = dayNumber(today);

  let best = 0;
  let run = 0;
  let current = 0;
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && days[i] - days[i - 1] === 1 ? run + 1 : 1;
    if (run > best) best = run;
    // The run this date ends is the current streak while its last day is still
    // live; a later date overwrites that, so the final assignment wins.
    if (days[i] >= now - 1) current = run;
  }
  return { current, best };
};
