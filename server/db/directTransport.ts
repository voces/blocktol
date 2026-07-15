import { is } from "../../common/typeguards.ts";
import { env } from "../util/env.ts";
import { errText, log } from "../util/logging.ts";

// The only slice of mysql2's pool we touch. Declared locally rather than pulled
// from the package's types: mysql2 defines `query` via a mixin base class that
// Deno's type-checker doesn't surface on the `Pool` interface. `[rows]` is the
// proxy-equivalent payload (see the module comment); we don't read `fields`.
type Pool = {
  query: (
    options: { sql: string; timeout?: number },
  ) => Promise<[unknown, unknown]>;
};

// The direct MariaDB connector: an alternative to the SQL proxy for the
// deployment co-located with the database (the w3x.io/EC2 box). It speaks the
// MySQL wire protocol straight to the server, skipping the proxy's HTTP hop
// entirely — the single biggest DB latency win once you're already on the box.
//
// It is a *transport swap only*: `query()` here returns the exact same shape the
// proxy's `query()` does, so every caller in server/db/* is untouched. That
// contract is:
//   - a single statement returns its result directly — an array of row objects
//     for a SELECT, or an ExecResult ({ affectedRows, insertId, ... }) for a
//     write;
//   - a multi-statement batch returns an array of those results, one per
//     statement.
// mysql2's `[rows]` matches this exactly: for one statement `rows` is the lone
// result; with `multipleStatements` on, a batch yields an array of results. That
// equivalence is what lets `SET @var` / `START TRANSACTION` ... `COMMIT` batches
// (startRun, updateCurrentRun, mergeUsers) run here unchanged — mysql2 runs the
// whole batch on one pooled connection, the same single-connection guarantee the
// proxy gives.
//
// Result coercion is tuned to reproduce the proxy's JSON output value-for-value:
//   - decimalNumbers: ROUND(...) yields DECIMAL; callers read those as numbers
//     (bestBuild, ownBest, ...), so return numbers, not strings.
//   - dateStrings: return `created` as the literal stored string rather than a JS
//     Date, matching a JSON-serialized timestamp. The co-located box runs in UTC
//     (as does the stored data), so the naive string and the app's `new Date(...)`
//     agree on the instant; `UNIX_TIMESTAMP(...)` reads are timezone-independent
//     regardless.
// tinyint(1) booleans come back as 0/1 numbers either way (callers do `!!flag`).

class SQLError extends Error {}

// A server-reported SQL error (bad syntax, constraint violation, ...) carries a
// `sqlState` string; a transport/connection failure (ECONNREFUSED, connection
// lost, query timeout) does not. We mirror the proxy's split: a SQLError throws
// immediately (retrying can't help and an INSERT retry could double-write),
// while a transport failure is retryable for idempotent callers (`sql`, retries
// = 1) and not for `sqlOnce` (retries = 0).
const isServerError = is.object({ sqlState: is.string });

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} must be set for the direct connector`);
  return value;
};

// Match the proxy's 3s ceiling on a single query (its fetch abort timeout). On
// hit mysql2 raises a non-server error, so `sql` retries and `sqlOnce` doesn't —
// same semantics as the proxy's aborted-fetch retry.
const QUERY_TIMEOUT_MS = 3000;

let poolPromise: Promise<Pool> | null = null;

// Lazily create the pool (and lazily import mysql2) on first use, so a
// proxy-transport deployment — including Deno Deploy — never loads the driver or
// opens a socket. `env` supplies the defaults so a co-located box only needs to
// flip SQL_TRANSPORT=direct: user/database default to `blocktol-<env>` (the same
// names the proxy passes through), host to loopback.
const getPool =
  () => (poolPromise ??= import("mysql2/promise").then(({ createPool }) =>
    createPool({
      host: Deno.env.get("SQL_HOST") ?? "127.0.0.1",
      port: Number(Deno.env.get("SQL_PORT") ?? "3306"),
      user: Deno.env.get("SQL_USER") ?? `blocktol-${env}`,
      password: requiredEnv("SQL_PASSWORD"),
      database: Deno.env.get("SQL_DATABASE") ?? `blocktol-${env}`,
      multipleStatements: true,
      dateStrings: true,
      decimalNumbers: true,
      connectionLimit: 10,
      enableKeepAlive: true,
    }) as unknown as Pool
  ));

export const directQuery = async <T = unknown>(
  queryStr: string,
  retries = 1,
): Promise<T> => {
  let lastError: unknown;

  while (retries-- >= 0) {
    try {
      const pool = await getPool();
      const [rows] = await pool.query({
        sql: queryStr,
        timeout: QUERY_TIMEOUT_MS,
      });
      if (lastError) log.info("recovered");
      return rows as T;
    } catch (err) {
      // A server SQL error is deterministic — surface it, don't retry.
      if (isServerError(err)) {
        throw new SQLError(err instanceof Error ? err.message : String(err));
      }
      lastError = err;
      log.error("db query failed", {
        retriesRemaining: retries + 1,
        error: errText(err),
      });
    }
  }

  throw new Error("Failed to query", { cause: lastError });
};
