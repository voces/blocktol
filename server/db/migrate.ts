import { errText, log } from "../util/logging.ts";
import { migrations, pendingMigrations } from "./migrations.ts";
import { type ExecResult, raw, sql, sqlMigrate } from "./query.ts";

const SCHEMA_MIGRATION = `
  CREATE TABLE IF NOT EXISTS schema_migration (
    version INT NOT NULL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`;

// A single-row lease lock. GET_LOCK can't be used here: it is connection-scoped
// and every `sql` call is a separate HTTP request to the proxy (a different
// connection), so a lock taken in one call is gone by the next. A row survives
// across calls, and the TTL means a migrator that crashes mid-run frees the
// lease automatically instead of wedging every future boot.
const SCHEMA_MIGRATION_LOCK = `
  CREATE TABLE IF NOT EXISTS schema_migration_lock (
    id TINYINT NOT NULL PRIMARY KEY,
    holder VARCHAR(64) NULL,
    locked_until TIMESTAMP NULL DEFAULT NULL
  );`;

const LOCK_TTL_SECONDS = 60;

// The holder pushes its lease out this often while it works. A migration can
// outlast the TTL (a big ALTER takes minutes), and a lease that lapsed mid-run
// would let a waiting isolate claim it and re-apply the same DDL. A third of the
// TTL leaves room for a renewal or two to fail before the lease actually
// expires; a holder that truly dies still frees it within the TTL.
const RENEW_EVERY_MS = (LOCK_TTL_SECONDS / 3) * 1000;

// A loser of the lease election polls at this interval until the winner has
// recorded the target version, and gives up after WAIT_CAP_MS — longer than any
// migration we expect, short enough that a wedged migrator surfaces (the throw
// lands in index.ts's best-effort catch, which logs, alerts and opens the gate)
// rather than holding every request on this process indefinitely.
const WAIT_POLL_MS = 2000;
const WAIT_CAP_MS = 15 * 60 * 1000;

const ensureTables = () =>
  sql`
    ${raw(SCHEMA_MIGRATION)}
    ${raw(SCHEMA_MIGRATION_LOCK)}
    INSERT IGNORE INTO schema_migration_lock (id) VALUES (1);`;

// Try to claim the lease. The WHERE clause matches only when the lock is free
// (never taken or expired), so exactly one concurrent caller flips the row and
// sees affectedRows === 1; the rest see 0 and back off.
const acquireLock = async (holder: string) => {
  const res = await sql<ExecResult>`
    UPDATE schema_migration_lock
    SET holder = ${holder}, locked_until = NOW() + INTERVAL ${LOCK_TTL_SECONDS} SECOND
    WHERE id = 1 AND (locked_until IS NULL OR locked_until < NOW());`;
  return res.affectedRows === 1;
};

// Extend a lease we still hold. Matching on `holder` means a lease that already
// lapsed and was claimed by someone else is never stolen back — the renewal
// just reports it (affectedRows 0), so the log shows two migrators overlapped.
const renewLock = (holder: string) =>
  sql<ExecResult>`
    UPDATE schema_migration_lock
    SET locked_until = NOW() + INTERVAL ${LOCK_TTL_SECONDS} SECOND
    WHERE id = 1 AND holder = ${holder};`;

const releaseLock = (holder: string) =>
  sql`
    UPDATE schema_migration_lock
    SET holder = NULL, locked_until = NULL
    WHERE id = 1 AND holder = ${holder};`;

const currentVersion = () =>
  sql<{ version: number }[]>`
    SELECT COALESCE(MAX(version), 0) version FROM schema_migration;`
    .then((r) => r[0].version);

const targetVersion = migrations[migrations.length - 1].version;

// Apply every pending migration while holding the lease, renewing it in the
// background for as long as that takes. Each migration runs through sqlMigrate
// — no timeout, no retry — see query.ts for why the ordinary guards are unsafe
// for DDL.
const applyPending = async (holder: string) => {
  const renew = setInterval(() => {
    renewLock(holder).then((r) => {
      if (r.affectedRows !== 1) log.warn("migration lease lost mid-run");
    }).catch((err) =>
      log.warn("migration lease renewal failed", { error: errText(err) })
    );
  }, RENEW_EVERY_MS);
  try {
    // Re-read under the lock: another isolate may have applied some (or all) of
    // these between our first check and winning the lease.
    for (const m of pendingMigrations(await currentVersion())) {
      log.info("applying migration", { version: m.version, name: m.name });
      await sqlMigrate`
        ${raw(m.up)}
        INSERT INTO schema_migration (version, name) VALUES (${m.version}, ${m.name});`;
    }
  } finally {
    clearInterval(renew);
    await releaseLock(holder);
  }
  log.info("schema migrated", { version: targetVersion });
};

// Bring the database up to the latest schema version, applying every pending
// migration in order. Safe to call from many isolates at once (e.g. on boot):
// the lease lock elects a single migrator, and the version is re-read under the
// lock so a caller that waited never re-applies what the winner already did.
//
// A caller that loses the election WAITS for the winner rather than returning:
// its resolution is what opens the `ready` gate in index.ts, and returning at
// once let a losing process serve requests against a schema its code predates
// for as long as the winner's migration ran. It polls the recorded version and
// re-tries the lease each round, so a winner that died mid-run (its lease
// lapsing) is taken over rather than waited on until the cap.
//
// Idempotent and cheap when nothing is pending — the common case is two indexed
// reads and no lock contention.
export const migrate = async () => {
  await ensureTables();

  if (pendingMigrations(await currentVersion()).length === 0) {
    log.info("schema up to date");
    return;
  }

  const holder = crypto.randomUUID();
  const deadline = Date.now() + WAIT_CAP_MS;
  let announced = false;
  while (!await acquireLock(holder)) {
    if (!announced) {
      log.info("migration in progress on another isolate; waiting for it");
      announced = true;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `gave up after ${
          WAIT_CAP_MS / 60_000
        } min waiting for another isolate to migrate to v${targetVersion}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_MS));
    if (pendingMigrations(await currentVersion()).length === 0) {
      log.info("schema migrated by another isolate", {
        version: targetVersion,
      });
      return;
    }
  }

  await applyPending(holder);
};

if (import.meta.main) {
  try {
    await migrate();
  } catch (err) {
    log.error("migration failed", { error: errText(err) });
    Deno.exit(1);
  }
}
