import { env } from "./env.ts";
import { log } from "./logging.ts";

// Central NewRelic error reporting.
//
// The new Deno Deploy runs ephemeral, request-scoped isolates, so we can't run
// the NewRelic Node agent or buffer/flush on a timer (an evicted isolate would
// silently drop anything still in memory). Instead every error is POSTed to
// NewRelic's Log API the moment it happens, fire-and-forget.
//
// The Log API takes the ingest (license) key in the `Api-Key` header and needs
// no account id in the URL (unlike the Events API used by metrics.ts). Reports
// land in the Logs UI searchable by `service` / `env` / `source`, and NewRelic's
// Errors Inbox groups them off the `error.message` / `error.stack` attributes.
//
// Two sources feed this: the server itself (unhandled exceptions, handler 5xxs)
// and the client, whose errors ride the `reportClientError` endpoint and are
// forwarded here — so a crash a player hits is visible to us, not just to their
// console. See server/routes/reportClientError.ts and client/util/errorReport.ts.

const apiKey = Deno.env.get("NEW_RELIC_API_KEY");

// US region collector (matches the metric/event endpoints in metrics.ts). EU
// accounts would use log-api.eu.newrelic.com.
const LOG_API = "https://log-api.newrelic.com/log/v1";

export type ErrorSource = "server" | "client";

export type ErrorReport = {
  source: ErrorSource;
  message: string;
  // The thrown value, if any — its message/stack are lifted into dedicated
  // attributes so NewRelic's Errors Inbox can group on them.
  error?: unknown;
  // Extra structured context (method, url, userId, status, ...).
  attributes?: Record<string, unknown>;
};

const errorAttributes = (
  error: unknown,
): { "error.message"?: string; "error.stack"?: string } => {
  if (error === undefined || error === null) return {};
  if (error instanceof Error) {
    return { "error.message": error.message, "error.stack": error.stack };
  }
  if (typeof error === "string") return { "error.message": error };
  try {
    return { "error.message": JSON.stringify(error) };
  } catch {
    return { "error.message": String(error) };
  }
};

// Report an error to NewRelic. Fire-and-forget: never awaited, never throws, so
// a reporting failure (or an absent key) can't break the request handling it
// describes. Console logging stays the caller's job — this is purely the
// NewRelic sink — so wiring it in never doubles the local logs.
export const reportError = (report: ErrorReport): void => {
  if (!apiKey) return;

  const body = [{
    logs: [{
      timestamp: Date.now(),
      message: report.message,
      attributes: {
        service: "blocktol",
        env,
        level: "error",
        source: report.source,
        ...errorAttributes(report.error),
        ...report.attributes,
      },
    }],
  }];

  fetch(LOG_API, {
    method: "POST",
    headers: { "Api-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch((err) => log.error("newrelic report failed", err));
};
