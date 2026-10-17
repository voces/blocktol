import { api } from "../api.ts";
import { allowReport } from "./reportGate.ts";

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
// Dedupe + rate-limit (reportGate.ts, shared with the api proxy's
// failed-request reports) so a tight error loop can't hammer the endpoint. The
// api proxy already swallows a failed report (never reporting a failed
// report), so this can't feed itself during an outage.

const report = (message: string, data: Record<string, unknown>) => {
  if (!allowReport(message)) return;
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
