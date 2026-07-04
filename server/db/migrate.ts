import { log } from "../util/logging.ts";
import { migrations, pendingMigrations } from "./migrations.ts";
import { raw, sql } from "./query.ts";

const SCHEMA_MIGRATION = `
  CREATE TABLE IF NOT EXISTS schema_migration (
    version INT NOT NULL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`;

// Bring the database up to the latest schema version, applying every pending
// migration in order. Idempotent: with nothing pending it is a cheap read.
//
// Intended to be run as a single one-shot invocation (`deno task migrate`), not
// concurrently — the version table is the source of truth, and each migration
// records its own version in the same statement it runs, so a re-run resumes
// from wherever the last one stopped. v1 is idempotent, so re-running a partial
// baseline is safe; a later migration that half-applies (DDL auto-commits in
// MySQL) may need manual cleanup before the next run.
export const migrate = async () => {
  await sql`${raw(SCHEMA_MIGRATION)}`;

  const [{ version }] = await sql<{ version: number }[]>`
    SELECT COALESCE(MAX(version), 0) version FROM schema_migration;`;

  const pending = pendingMigrations(version);
  if (pending.length === 0) {
    log.info("schema up to date at version", version);
    return;
  }

  for (const m of pending) {
    log.info("applying migration", m.version, m.name);
    await sql`
      ${raw(m.up)}
      INSERT INTO schema_migration (version, name) VALUES (${m.version}, ${m.name});`;
  }

  log.info(
    "schema migrated to version",
    migrations[migrations.length - 1].version,
  );
};

if (import.meta.main) {
  try {
    await migrate();
  } catch (err) {
    log.error("migration failed", err);
    Deno.exit(1);
  }
}
