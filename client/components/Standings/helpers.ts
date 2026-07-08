// Pure formatting for the standings dock/sheet, split out for unit tests.
// Each takes `now` so tests don't race the clock.

// "T2" when the rank is shared, plain "2" otherwise.
export const formatRank = (rank: number, tied: boolean) =>
  `${tied ? "T" : ""}${rank}`;

// When a row's best was set — "now", "5m ago", "19h ago", "3d ago". Coarser
// than the runs panel's formatter on purpose: board rows span the whole field,
// so second precision and date fallbacks would just add noise.
export const formatAgo = (at: number, now = Date.now()) => {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

// Time left until the field closes and the day gets ranked — "9h 41m", then
// "41m", then "soon" once the close has passed but the rating cron hasn't
// swept it yet.
export const formatCountdown = (closesAt: number, now = Date.now()) => {
  const m = Math.ceil((closesAt - now) / 60_000);
  if (m <= 0) return "soon";
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
};

// The sheet's header date ("Jul 7") from the server's [y, m, d] day tuple.
// Built as a LOCAL date so locale formatting can't shift it across midnight.
export const formatDay = ([y, m, d]: readonly [number, number, number]) =>
  new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

// Board times render with a fixed two decimals ("35.10s") so the column's
// digits align down the sheet.
export const formatTime = (time: number) => time.toFixed(2);
