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

// The SQL proxy endpoint. A host co-located with the proxy (the EC2 cohost)
// sets SQL_PROXY_URL to its localhost address to skip the internet round-trip.
// The proxy contract is identical either way.
const SQL_PROXY_URL = Deno.env.get("SQL_PROXY_URL") ?? "https://w3x.io/sql";

// Transport, chosen once at boot:
//   - "proxy" (default): HTTP to the SQL proxy at SQL_PROXY_URL.
//   - "direct": the MySQL wire protocol straight to the DB (directTransport.ts),
//     for the box co-located with the database.
// Both return the same result shape, so nothing downstream of `query` cares.
// Anything off the box (a local run, CI's integration tests) stays on the
// proxy; only the co-located box sets SQL_TRANSPORT=direct.
const useDirect = Deno.env.get("SQL_TRANSPORT") === "direct";

// How one `query` call behaves on failure: `retries` re-sends after a transport
// failure (never after a server SQL error), and `timeoutMs` bounds one attempt
// end to end (null = unbounded — migrations only, see sqlMigrate).
export type QueryOptions = { retries: number; timeoutMs: number | null };

// Ceiling on one attempt for ordinary traffic. A timeout is a transport
// failure: `sql` retries it, `sqlOnce` doesn't.
export const QUERY_TIMEOUT_MS = 3000;

const proxyQuery = async <T = unknown>(
  query: string,
  { retries, timeoutMs }: QueryOptions,
): Promise<T> => {
  // One attempt. The abort covers the BODY read too: a timer cleared when
  // `fetch` resolves would let a proxy that stalls mid-body hang the request
  // forever.
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
      // Read as text first so a non-JSON reply (an HTML error page from the
      // proxy or a gateway) can be logged with its status and a body snippet.
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

// The entry point every helper below uses: picks the transport and wraps the
// call in a `db.transport` span, since the direct socket isn't auto-traced like
// the proxy's `fetch` (see trace.ts).
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
// re-run a query that landed but whose response was lost (e.g. the 3s timeout),
// duplicating the row, such as a silently spent daily attempt. Idempotent
// writes (upserts, absolute-value UPDATEs) keep using `sql`.
export const sqlOnce = <T = unknown>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) =>
  query<T>(SqlString.format(strings.join("?"), values), {
    retries: 0,
    timeoutMs: QUERY_TIMEOUT_MS,
  });

// For schema migrations (db/migrate.ts) only: no retry AND no timeout. A big
// ALTER can run for minutes. The 3s timeout would fail it client-side while the
// DDL keeps running (orphaning the batch's trailing `schema_migration` write),
// and a retry would re-send the DDL at a table still being altered. The
// renewed migration lease keeps other isolates off it meanwhile.
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
