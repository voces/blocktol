import SqlString from "sqlstring";
import { is } from "../../common/typeguards.ts";
import { env } from "../util/env.ts";
import { errText, log } from "../util/logging.ts";
import { directQuery, SQLError } from "./directTransport.ts";
import { withDbSpan } from "./trace.ts";

const isSqlError = is.object({
  code: is.number,
  message: is.string,
});

// The SQL proxy endpoint. Defaults to the public proxy over the internet; on a
// host co-located with the proxy (the EC2 cohost) set SQL_PROXY_URL to its
// localhost address to drop the internet round-trip — the single biggest DB
// latency win of the move. The proxy contract (headers, multi-statement
// batching, session variables) is identical either way; this only changes where
// the request is sent.
const SQL_PROXY_URL = Deno.env.get("SQL_PROXY_URL") ?? "https://w3x.io/sql";

// Transport selection. Two ways to reach MariaDB, chosen once at boot:
//   - "proxy" (default): HTTP to the SQL proxy at SQL_PROXY_URL, below.
//   - "direct": the MySQL wire protocol straight to the DB (directTransport.ts),
//     for the deployment co-located with the database — no proxy hop at all.
// Both return the identical result shape (see directTransport.ts), so nothing
// downstream of `query` cares which is in use. Deno Deploy previews leave this
// unset and stay on the proxy; only the co-located box sets
// SQL_TRANSPORT=direct.
const useDirect = Deno.env.get("SQL_TRANSPORT") === "direct";

// How one `query` call behaves on failure: `retries` re-sends after a transport
// failure (never after a server SQL error), and `timeoutMs` bounds one attempt
// end to end (null = unbounded — migrations only, see sqlMigrate).
export type QueryOptions = { retries: number; timeoutMs: number | null };

// The ceiling on one attempt for ordinary traffic. On hit the attempt counts as
// a transport failure, so `sql` retries and `sqlOnce` doesn't.
export const QUERY_TIMEOUT_MS = 3000;

const proxyQuery = async <T = unknown>(
  query: string,
  { retries, timeoutMs }: QueryOptions,
): Promise<T> => {
  // One attempt, timeout and all. The abort covers the BODY read too, not just
  // the headers (a timer cleared when `fetch` resolves lets a proxy that sends
  // its headers and then stalls mid-body hang the request, and everything
  // awaiting it, forever).
  const attempt = async () => {
    const controller = new AbortController();
    const timeout = timeoutMs === null
      ? undefined
      : setTimeout(() => controller.abort(), timeoutMs);
    try {
      const ret = await fetch(SQL_PROXY_URL, {
        headers: {
          "x-dbproxy-user": `blocktol-${env}`,
          "x-dbproxy-password": Deno.env.get("SQL_PASSWORD")!,
          "x-dbproxy-database": `blocktol-${env}`,
        },
        method: "POST",
        body: query,
        signal: controller.signal,
      });
      // Read as text first: when the proxy (or an upstream gateway) returns an
      // HTML error page instead of JSON, log the status and a body snippet so
      // the actual failure is visible, rather than a bare "Unexpected token '<'".
      return { ret, text: await ret.text() };
    } catch (err) {
      if (controller.signal.aborted) throw new Error("Timeout", { cause: err });
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  };

  let lastError: unknown;

  while (retries-- >= 0) {
    try {
      const { ret, text } = await attempt();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        log.error("non-JSON response from SQL proxy", {
          status: ret.status,
          contentType: ret.headers.get("content-type"),
          body: text.slice(0, 500),
        });
        throw new Error(`SQL proxy returned non-JSON (status ${ret.status})`);
      }
      if (isSqlError(json)) throw new SQLError(json.message);
      if (lastError) log.info("recovered");
      return json as T;
    } catch (err) {
      if (err instanceof SQLError) throw err;
      lastError = err;
      log.error("db fetch failed", {
        retriesRemaining: retries + 1,
        error: errText(err),
      });
    }
  }

  throw new Error("Failed to fetch", { cause: lastError });
};

// The one entry point every helper below funnels through: pick the transport
// and wrap the call in a `db.transport`-tagged span so DB timing is visible on
// either path (the direct connector's raw socket isn't auto-traced the way the
// proxy's `fetch` is — see trace.ts).
const query = <T = unknown>(
  query: string,
  options: QueryOptions,
): Promise<T> =>
  withDbSpan(
    useDirect ? "direct" : "proxy",
    query,
    () =>
      useDirect
        ? directQuery<T>(query, options)
        : proxyQuery<T>(query, options),
  );

export const sql = <T = unknown>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) => {
  // log.info(format(strings, ...values));
  return query<T>(SqlString.format(strings.join("?"), values), {
    retries: 1,
    timeoutMs: QUERY_TIMEOUT_MS,
  });
};

// For non-idempotent statements (bare INSERTs): no retry. `sql`'s retry can
// re-execute a query whose first attempt actually landed but whose response
// was lost (e.g. the 3s timeout) — for an INSERT that means a duplicate row,
// e.g. a silently spent daily attempt. Idempotent writes (upserts, UPDATEs
// that set absolute values) should keep using `sql`; the retry is safe there.
export const sqlOnce = <T = unknown>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) =>
  query<T>(SqlString.format(strings.join("?"), values), {
    retries: 0,
    timeoutMs: QUERY_TIMEOUT_MS,
  });

// For schema migrations (db/migrate.ts) only: no retry AND no timeout. A big
// ALTER can legitimately run for minutes and neither ordinary guard is safe for
// it: the 3s timeout fails it client-side while the DDL keeps running on the
// server (an abort can't stop it — it only orphans the batch's trailing
// `schema_migration` bookkeeping), and the retry then re-sends the same DDL at a
// table the first copy is still altering. The migration lease, renewed while
// this runs, is what keeps other isolates off it meanwhile.
export const sqlMigrate = <T = unknown>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) =>
  query<T>(SqlString.format(strings.join("?"), values), {
    retries: 0,
    timeoutMs: null,
  });

export const format = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => SqlString.format(strings.join("?"), values);

export type ExecResult = {
  fieldCount: number;
  affectedRows: number;
  insertId: number;
  info: string;
  serverStatus: number;
  warningStatus: number;
};

export const raw = (data: { raw: readonly string[] } | string) => ({
  toSqlString: () => typeof data === "string" ? data : data.raw.join(""),
});
