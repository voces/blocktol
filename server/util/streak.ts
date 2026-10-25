// Consecutive-day streaks over the dates a player has a ranked result on.
//
// Pure and based on `YYYY-MM-DD` strings (an iteration's `created` DATE), so no
// timezone is involved: a daily belongs to a calendar date. Parsing at UTC
// midnight only yields a day number for the gap arithmetic.

const DAY = 86_400_000;

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY;

// Longest and current runs of consecutive days in `dates` (any order,
// duplicates fine). The current run ends today or yesterday: the player's local
// day may still be running after the server's has rolled over. A date ahead of
// the server's `today` just becomes the run's newest day.
export const streaks = (dates: readonly string[], today: string) => {
  const days = [...new Set(dates)].map(dayNumber).sort((a, b) => a - b);
  const now = dayNumber(today);

  let best = 0;
  let run = 0;
  let current = 0;
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && days[i]! - days[i - 1]! === 1 ? run + 1 : 1;
    if (run > best) best = run;
    // A later date overwrites this, so the final assignment wins.
    if (days[i]! >= now - 1) current = run;
  }
  return { current, best };
};
