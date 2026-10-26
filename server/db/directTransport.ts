import { is } from "../../common/typeguards.ts";
import { env } from "../util/env.ts";
import { errText, log } from "../util/logging.ts";
import type { QueryOptions } from "./query.ts";
import process from "node:process";

// The only slice of mysql2's pool we touch. `[rows]` is the proxy-equivalent
// payload (see below); `fields` is unused.
type Connection = {
  query: (
    options: { sql: string; timeout?: number },
  ) => Promise<[unknown, unknown]>;
  release: () => void;
  destroy: () => void;
};
type Pool = { getConnection: () => Promise<Connection> };

// The direct MariaDB connector: an alternative to the SQL proxy for the box
// co-located with the database. It speaks the MySQL wire protocol straight to
// the server, skipping the proxy's HTTP hop.
//
// It is a *transport swap only*: `directQuery` returns the same shape as the
// proxy path, so no caller in server/db/* changes:
//   - a single statement returns its result directly (row objects for a SELECT,
//     an ExecResult for a write);
//   - a multi-statement batch returns an array of those results.
// mysql2's `[rows]` matches this (with `multipleStatements` on, a batch yields
// an array), and runs the whole batch on one pooled connection, so `SET @var` /
// `START TRANSACTION` ... `COMMIT` batches work as on the proxy.
//
// Coercion reproduces the proxy's JSON output:
//   - decimalNumbers: ROUND(...) yields DECIMAL, which callers read as numbers.
//   - dateStrings: `created` comes back as the stored string, not a JS Date.
//     The box and the stored data are UTC, so `new Date(...)` on it agrees with
//     the proxy; `UNIX_TIMESTAMP(...)` reads are timezone-independent anyway.
// tinyint(1) booleans are 0/1 numbers on both transports (callers do `!!flag`).

// A server-reported SQL error (either transport): deterministic, never retried,
// distinguishable from a transport failure.
export class SQLError extends Error {}

// A server-reported SQL error (syntax, constraint violation, ...) carries a
// `sqlState` string; a transport failure (ECONNREFUSED, connection lost, query
// timeout) does not. As on the proxy, a SQLError throws at once (a retry can't
// help and could double-write); a transport failure is retried only by `sql`.
const isServerError = is.object({ sqlState: is.string });

const requiredEnv = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set for the direct connector`);
  return value;
};

// How long a query may wait for a free pooled connection. Separate from the
// per-query timeout, which mysql2 starts only once the query is on a
// connection; without it a saturated pool queues callers forever. mysql2
// ignores `acquireTimeout`, hence the race in `acquire`. Expiry is a transport
// failure.
const ACQUIRE_TIMEOUT_MS = 5000;

// Past this many waiters, fail fast ("Queue limit reached", also a transport
// failure) rather than pile up requests that would mostly time out.
const QUEUE_LIMIT = 500;

let poolPromise: Promise<Pool> | null = null;

// Creates the pool (and imports mysql2) on first use, so a process on the
// proxy transport never loads the driver. User/database
// default to `blocktol-<env>` (the names the proxy uses) and host to loopback,
// so the co-located box only sets SQL_TRANSPORT=direct.
const getPool =
  () => (poolPromise ??= import("mysql2/promise").then(({ createPool }) =>
    createPool({
      host: process.env.SQL_HOST ?? "127.0.0.1",
      port: Number(process.env.SQL_PORT ?? "3306"),
      user: process.env.SQL_USER ?? `blocktol-${env}`,
      password: requiredEnv("SQL_PASSWORD"),
      database: process.env.SQL_DATABASE ?? `blocktol-${env}`,
      multipleStatements: true,
      dateStrings: true,
      decimalNumbers: true,
      connectionLimit: 10,
      queueLimit: QUEUE_LIMIT,
      enableKeepAlive: true,
    }) as unknown as Pool
  ));

const acquire = (pool: Pool) =>
  new Promise<Connection>((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new Error("Timeout acquiring a pooled connection"));
    }, ACQUIRE_TIMEOUT_MS);
    pool.getConnection().then((conn) => {
      // Arrived after the timeout: hand it back rather than leak it.
      if (timedOut) return conn.release();
      clearTimeout(timer);
      resolve(conn);
    }, (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

// One attempt on an explicitly checked-out connection, so its fate on failure
// is ours to decide (`pool.query` always releases it back):
//   - A server error mid-batch stops the batch there. Inside a
//     `START TRANSACTION … COMMIT` batch (createIteration, applyRatings,
//     mergeUsers, ...) that leaves the connection holding an OPEN transaction
//     and its locks, which the next borrower's statements would silently join.
//     So ROLLBACK first (a no-op when none is open), and destroy the connection
//     if even that fails.
//   - A transport error, notably mysql2's query timeout, which only stops
//     waiting and leaves late results queued on the socket, means the
//     connection's protocol state can't be trusted: destroy it (the server
//     rolls back what it had open) and let the pool open a fresh one.
const attempt = async (sql: string, timeoutMs: number | null) => {
  const conn = await acquire(await getPool());
  try {
    const [rows] = await conn.query({
      sql,
      ...(timeoutMs === null ? {} : { timeout: timeoutMs }),
    });
    conn.release();
    return rows;
  } catch (err) {
    if (isServerError(err)) {
      try {
        await conn.query({ sql: "ROLLBACK", timeout: 3000 });
        conn.release();
      } catch {
        conn.destroy();
      }
    } else {
      conn.destroy();
    }
    throw err;
  }
};

export const directQuery = async <T = unknown>(
  queryStr: string,
  { retries, timeoutMs }: QueryOptions,
): Promise<T> => {
  let lastError: unknown;

  while (retries-- >= 0) {
    try {
      const rows = await attempt(queryStr, timeoutMs);
      if (lastError) log.info("recovered");
      return rows as T;
    } catch (err) {
      // A server SQL error is deterministic — surface it, don't retry.
      if (isServerError(err)) {
        throw new SQLError(
          err instanceof Error ? err.message : JSON.stringify(err),
        );
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
