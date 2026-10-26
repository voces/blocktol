import { errText, log } from "../util/logging.ts";
import { migrations, pendingMigrations } from "./migrations.ts";
import { type ExecResult, raw, sql, sqlMigrate } from "./query.ts";
import process from "node:process";

const SCHEMA_MIGRATION = `
  CREATE TABLE IF NOT EXISTS schema_migration (
    version INT NOT NULL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`;

// A single-row lease lock. GET_LOCK is connection-scoped and each `sql` call is
// a separate proxy request (a different connection), so it wouldn't survive
// between calls. A row does, and the TTL frees the lease if a migrator crashes
// instead of wedging every future boot.
const SCHEMA_MIGRATION_LOCK = `
  CREATE TABLE IF NOT EXISTS schema_migration_lock (
    id TINYINT NOT NULL PRIMARY KEY,
    holder VARCHAR(64) NULL,
    locked_until TIMESTAMP NULL DEFAULT NULL
  );`;

const LOCK_TTL_SECONDS = 60;

// The holder renews its lease this often. A big ALTER can outlast the TTL, and
// a lapsed lease would let a waiting process re-apply the same DDL. A third of
// the TTL leaves room for a renewal or two to fail.
const RENEW_EVERY_MS = (LOCK_TTL_SECONDS / 3) * 1000;

// A loser of the lease election polls at this interval until the winner has
// recorded the target version, and gives up after WAIT_CAP_MS: longer than any
// expected migration, short enough that a wedged migrator surfaces (the throw
// lands in index.ts's best-effort catch, which logs, alerts and opens the gate)
// instead of holding every request.
const WAIT_POLL_MS = 2000;
const WAIT_CAP_MS = 15 * 60 * 1000;

const ensureTables = () =>
  sql`
    ${raw(SCHEMA_MIGRATION)}
    ${raw(SCHEMA_MIGRATION_LOCK)}
    INSERT IGNORE INTO schema_migration_lock (id) VALUES (1);`;

// Tries to claim the lease. The WHERE matches only a free lock (never taken or
// expired), so exactly one concurrent caller sees affectedRows === 1.
const acquireLock = async (holder: string) => {
  const res = await sql<ExecResult>`
    UPDATE schema_migration_lock
    SET holder = ${holder}, locked_until = NOW() + INTERVAL ${LOCK_TTL_SECONDS} SECOND
    WHERE id = 1 AND (locked_until IS NULL OR locked_until < NOW());`;
  return res.affectedRows === 1;
};

// Extends a lease we still hold. Matching on `holder` means a lapsed lease
// claimed by someone else is not stolen back; affectedRows 0 reports the
// overlap.
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
    .then((r) => r[0]!.version);

const targetVersion = migrations[migrations.length - 1]!.version;

// Applies every pending migration while holding the lease, renewing it in the
// background. Each runs through sqlMigrate (no timeout, no retry; see
// query.ts).
const applyPending = async (holder: string) => {
  const renew = setInterval(() => {
    renewLock(holder).then((r) => {
      if (r.affectedRows !== 1) log.warn("migration lease lost mid-run");
    }).catch((err) =>
      log.warn("migration lease renewal failed", { error: errText(err) })
    );
  }, RENEW_EVERY_MS);
  try {
    // Re-read under the lock: another process may have applied some of these
    // since our first check.
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

// Brings the database to the latest schema version. Safe to call from many
// processes at once: the lease elects a single migrator, and the version is
// re-read under the lock so a waiter never re-applies the winner's work.
//
// A caller that loses the election WAITS rather than returning: its resolution
// opens the `ready` gate in index.ts, and returning early would serve requests
// against a schema its code predates. Each round it polls the recorded version
// and retries the lease, so a winner that died mid-run is taken over instead of
// waited on until the cap.
//
// Cheap when nothing is pending (two indexed reads, no lock).
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
      log.info("migration in progress on another process; waiting for it");
      announced = true;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `gave up after ${
          WAIT_CAP_MS / 60_000
        } min waiting for another process to migrate to v${targetVersion}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_MS));
    if (pendingMigrations(await currentVersion()).length === 0) {
      log.info("schema migrated by another process", {
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
    process.exit(1);
  }
}
