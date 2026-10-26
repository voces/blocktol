import { api } from "../api.ts";
import { allowReport } from "./reportGate.ts";

// Global client-error capture: uncaught exceptions and unhandled rejections go
// to the server's `reportClientError`, which logs them (VictoriaLogs, over
// OTLP). It's our own same-origin endpoint rather than a third-party browser
// agent: no SDK or keys in the bundle, no extra CSP surface, and it's the path
// ErrorBoundary and the api proxy already use.
//
// Reports pass through reportGate.ts (shared with the api proxy's
// failed-request reports) so a tight error loop can't hammer the endpoint. The
// api proxy never reports a failed report, so this can't feed itself during an
// outage.

const report = (message: string, data: Record<string, unknown>) => {
  if (!allowReport(message)) return;
  api.reportClientError({ message, data }).catch(() => {});
};

const describe = (value: unknown): string =>
  value instanceof Error ? value.stack ?? value.message : String(value);

export const installErrorReporting = () => {
  globalThis.addEventListener("error", (event) => {
    // Resource-load failures (a missing img/script) also fire "error" but carry
    // no `error`/stack; ignore them.
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
