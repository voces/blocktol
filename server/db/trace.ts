import { SpanStatusCode, trace } from "@opentelemetry/api";

// A manual OTel span around every DB call, tagged with the transport used.
//
// Why this exists: Deno's built-in OTel (OTEL_DENO=true) auto-instruments
// outbound `fetch`, so the SQL *proxy* hop already shows up as a span for free.
// The *direct* connector talks to MariaDB over a raw TCP socket (via mysql2) —
// which Deno's auto-instrumentation does NOT cover — so without this wrapper a
// direct-transport deployment would have a blind spot exactly where the proxy
// deployment has a span. Wrapping both paths keeps DB timing visible regardless
// of transport, and stamps `db.transport` so a trace makes plain which path a
// query took.
//
// The span carries only low-cardinality, non-sensitive attributes: the SQL
// verb (SELECT/INSERT/…) and the transport. The full statement is deliberately
// NOT attached — it embeds user UUIDs (the bearer credential) and other row
// data, and telemetry must never carry the raw id (see CLAUDE.md observability
// note).
//
// When OTel is off (every deployment except the co-located blocktol.com box, and
// all local/test runs), `@opentelemetry/api` falls back to a no-op tracer that
// simply invokes the callback — so this is a cheap passthrough there.
const tracer = trace.getTracer("blocktol-db");

export type DbTransport = "proxy" | "direct";

const operation = (statement: string) =>
  (statement.trimStart().split(/\s+/, 1)[0] || "query").toUpperCase();

export const withDbSpan = <T>(
  transport: DbTransport,
  statement: string,
  fn: () => Promise<T>,
): Promise<T> => {
  const op = operation(statement);
  return tracer.startActiveSpan(
    `db.query ${op}`,
    {
      attributes: {
        "db.system": "mariadb",
        "db.transport": transport,
        "db.operation": op,
      },
    },
    async (span) => {
      try {
        return await fn();
      } catch (err) {
        span.recordException(
          err instanceof Error ? err : new Error(String(err)),
        );
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw err;
      } finally {
        span.end();
      }
    },
  );
};
