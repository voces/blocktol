import { api } from "../api.ts";

// Global client-error capture. Uncaught exceptions and unhandled promise
// rejections are forwarded to the server's reportClientError endpoint, which
// logs them server-side (→ VictoriaLogs, via Deno's OTel) — so a crash a player
// hits is visible to us, not just sitting in their console.
//
// We route through our own same-origin endpoint rather than a third-party
// browser agent on purpose: no third-party SDK or its keys in the client bundle,
// no extra CSP surface, and it reuses the reporting path ErrorBoundary and the
// api proxy already use. (If we ever want full session replay, that's the point
// to add a dedicated browser SDK.)
//
// Dedupe + rate-limit so a tight error loop can't hammer the endpoint: the same
// message isn't resent within a short window, and there's a hard cap per page
// load. The api proxy already swallows a failed report (never reporting a failed
// report), so this can't feed itself during an outage.

const REPORT_WINDOW_MS = 10_000;
const MAX_REPORTS = 25;

const lastSent = new Map<string, number>();
let sent = 0;

const report = (message: string, data: Record<string, unknown>) => {
  if (sent >= MAX_REPORTS) return;
  const now = Date.now();
  const last = lastSent.get(message);
  if (last !== undefined && now - last < REPORT_WINDOW_MS) return;
  lastSent.set(message, now);
  sent++;
  api.reportClientError({ message, data }).catch(() => {});
};

const describe = (value: unknown): string =>
  value instanceof Error ? value.stack ?? value.message : String(value);

export const installErrorReporting = () => {
  globalThis.addEventListener("error", (event) => {
    // Resource-load failures (a missing img/script) also fire "error" but aren't
    // JS exceptions and carry no `error`/stack — ignore them; they'd be noise.
    if (!(event instanceof ErrorEvent)) return;
    report(event.message || "uncaught error", {
      error: event.error !== undefined ? describe(event.error) : event.message,
      source: event.filename,
      line: event.lineno,
      column: event.colno,
    });
  });

  globalThis.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    report(
      reason instanceof Error
        ? `unhandled rejection: ${reason.message}`
        : "unhandled rejection",
      { error: describe(reason) },
    );
  });
};
