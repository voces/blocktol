import SqlString from "sqlstring";
import { is } from "../../common/typeguards.ts";
import { env } from "../util/env.ts";
import { errText, log } from "../util/logging.ts";
import { directQuery } from "./directTransport.ts";
import { withDbSpan } from "./trace.ts";

const isSqlError = is.object({
  code: is.number,
  message: is.string,
});

class SQLError extends Error {}

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
// downstream of `query` cares which is in use. Deno Deploy leaves this unset and
// stays on the proxy; only the co-located box sets SQL_TRANSPORT=direct.
const useDirect = Deno.env.get("SQL_TRANSPORT") === "direct";

const proxyQuery = async <T = unknown>(
  query: string,
  retries = 1,
): Promise<T> => {
  const makeFetch = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const ret = await fetch(SQL_PROXY_URL, {
      headers: {
        "x-dbproxy-user": `blocktol-${env}`,
        "x-dbproxy-password": Deno.env.get("SQL_PASSWORD")!,
        "x-dbproxy-database": `blocktol-${env}`,
      },
      method: "POST",
      body: query,
      signal: controller.signal,
    }).catch((err) => err);
    if (ret instanceof Error) {
      if (ret.message === "The signal has been aborted") {
        throw new Error("Timeout", { cause: ret });
      }
      throw ret;
    }
    clearTimeout(timeout);

    return ret;
  };

  let lastError: unknown;

  while (retries-- >= 0) {
    try {
      const ret = await makeFetch();
      // Read as text first: when the proxy (or an upstream gateway) returns an
      // HTML error page instead of JSON, log the status and a body snippet so
      // the actual failure is visible, rather than a bare "Unexpected token '<'".
      const text = await ret.text();
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

// The one entry point both `sql` and `sqlOnce` funnel through: pick the
// transport and wrap the call in a `db.transport`-tagged span so DB timing is
// visible on either path (the direct connector's raw socket isn't auto-traced
// the way the proxy's `fetch` is — see trace.ts).
const query = <T = unknown>(query: string, retries = 1): Promise<T> =>
  withDbSpan(
    useDirect ? "direct" : "proxy",
    query,
    () =>
      useDirect
        ? directQuery<T>(query, retries)
        : proxyQuery<T>(query, retries),
  );

export const sql = <T = unknown>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) => {
  // log.info(format(strings, ...values));
  return query<T>(SqlString.format(strings.join("?"), values));
};

// For non-idempotent statements (bare INSERTs): no retry. `sql`'s retry can
// re-execute a query whose first attempt actually landed but whose response
// was lost (e.g. the 3s timeout) — for an INSERT that means a duplicate row,
// e.g. a silently spent daily attempt. Idempotent writes (upserts, UPDATEs
// that set absolute values) should keep using `sql`; the retry is safe there.
export const sqlOnce = <T = unknown>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) => query<T>(SqlString.format(strings.join("?"), values), 0);

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
