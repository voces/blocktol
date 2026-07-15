// The player's local calendar day and the next local-midnight instant, in the
// SAME zone the app reports to the server (getTimeZone() returns Intl's resolved
// zone — the browser's — and a Date's local fields are already in it). Ranked
// play is a strictly local-day affair: a ranked build window is hard-capped at
// the next local midnight, and a day change (a new daily is available) is
// detected by watching localDay() tick over. See store/dailyRollover.ts.

// [year, month, day], 1-indexed month — matching the server's dailyParts.
export const localDay = (): [number, number, number] => {
  const d = new Date();
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()];
};

// Epoch ms of the upcoming local midnight (00:00 tomorrow, local time). Setting
// hour 24 rolls to the next day at 00:00:00.000 in the browser's own zone.
export const nextLocalMidnight = (): number => {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.getTime();
};

export const sameDay = (
  a: [number, number, number],
  b: [number, number, number],
): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
