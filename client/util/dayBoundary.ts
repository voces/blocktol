// The player's local calendar day and the next local-midnight instant, in the
// same zone the app reports to the server (getTimeZone() is the browser's zone,
// which a Date's local fields already use). A ranked build window is capped at
// the next local midnight, and a new daily is detected by watching localDay()
// tick over. See store/dailyRollover.ts.

// [year, month, day], 1-indexed month — matching the server's dailyParts.
export const localDay = (): [number, number, number] => {
  const d = new Date();
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()];
};

// Epoch ms of the upcoming local midnight (hour 24 rolls to 00:00 tomorrow).
export const nextLocalMidnight = (): number => {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.getTime();
};

export const sameDay = (
  a: [number, number, number],
  b: [number, number, number],
): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

// True when calendar day `a` falls strictly before `b`.
export const dayIsBefore = (
  a: [number, number, number],
  b: [number, number, number],
): boolean =>
  a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];
