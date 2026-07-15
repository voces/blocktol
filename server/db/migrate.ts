import { errText, log } from "../util/logging.ts";
import { migrations, pendingMigrations } from "./migrations.ts";
import { type ExecResult, raw, sql } from "./query.ts";

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

// Try to claim the lease. The WHERE clause matches only when the lock is free
// (never taken or expired), so exactly one concurrent caller flips the row and
// sees affectedRows === 1; the rest see 0 and back off.
const acquireLock = async (holder: string) => {
  await sql`
    ${raw(SCHEMA_MIGRATION_LOCK)}
    INSERT IGNORE INTO schema_migration_lock (id) VALUES (1);`;
  const res = await sql<ExecResult>`
    UPDATE schema_migration_lock
    SET holder = ${holder}, locked_until = NOW() + INTERVAL ${LOCK_TTL_SECONDS} SECOND
    WHERE id = 1 AND (locked_until IS NULL OR locked_until < NOW());`;
  return res.affectedRows === 1;
};

const releaseLock = (holder: string) =>
  sql`
    UPDATE schema_migration_lock
    SET holder = NULL, locked_until = NULL
    WHERE id = 1 AND holder = ${holder};`;

const currentVersion = () =>
  sql<{ version: number }[]>`
    SELECT COALESCE(MAX(version), 0) version FROM schema_migration;`
    .then((r) => r[0].version);

// Bring the database up to the latest schema version, applying every pending
// migration in order. Safe to call from many isolates at once (e.g. on boot):
// the lease lock elects a single migrator, and the version is re-read under the
// lock so a caller that waited never re-applies what the winner already did. A
// caller that doesn't win the lock returns immediately.
//
// Idempotent and cheap when nothing is pending — the common case is two indexed
// reads and no lock contention.
export const migrate = async () => {
  await sql`${raw(SCHEMA_MIGRATION)}`;

  if (pendingMigrations(await currentVersion()).length === 0) {
    log.info("schema up to date");
    return;
  }

  const holder = crypto.randomUUID();
  if (!await acquireLock(holder)) {
    log.info("migration already in progress on another isolate; skipping");
    return;
  }

  try {
    // Re-read under the lock: another isolate may have applied some (or all) of
    // these between our first check and winning the lease.
    for (const m of pendingMigrations(await currentVersion())) {
      log.info("applying migration", { version: m.version, name: m.name });
      await sql`
        ${raw(m.up)}
        INSERT INTO schema_migration (version, name) VALUES (${m.version}, ${m.name});`;
    }
  } finally {
    await releaseLock(holder);
  }

  log.info("schema migrated", {
    version: migrations[migrations.length - 1].version,
  });
};

if (import.meta.main) {
  try {
    await migrate();
  } catch (err) {
    log.error("migration failed", { error: errText(err) });
    Deno.exit(1);
  }
}
