import { SpanStatusCode, trace } from "@opentelemetry/api";

// A manual OTel span around every DB call, tagged with the transport.
//
// Outbound `fetch` is traced by server/otel.ts (undici), so the proxy hop is
// already a span. The direct connector uses a raw TCP socket (mysql2), which
// that does NOT cover, so this wraps both paths to keep DB timing visible and
// to stamp `db.transport`.
//
// The span carries only the SQL verb and the transport. Never attach the
// statement: it embeds user UUIDs (the bearer credential) and row data, and
// telemetry must not carry the raw id (see server/CLAUDE.md, Observability).
//
// With OTel off (everywhere but the EC2 box, and in tests) `@opentelemetry/api`
// uses a no-op tracer, so this is a cheap passthrough.
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
