// The one throttle every automatic client-error report passes through, so a
// tight error loop can't hammer the endpoint: the same key isn't resent within
// a short window, and there's a hard cap per page load. Its own module (no
// imports) so both the global handlers (errorReport.ts) and the api proxy's
// failed-request reports (api.ts) can share it without an import cycle.

const REPORT_WINDOW_MS = 10_000;
const MAX_REPORTS = 25;

const lastSent = new Map<string, number>();
let sent = 0;

// True when a report keyed `key` may go out now (and counts it as sent).
export const allowReport = (key: string, now = Date.now()) => {
  if (sent >= MAX_REPORTS) return false;
  const last = lastSent.get(key);
  if (last !== undefined && now - last < REPORT_WINDOW_MS) return false;
  lastSent.set(key, now);
  sent++;
  return true;
};
