export type Migration = { version: number; name: string; up: string };

// Ordered schema migrations. Each runs exactly once per database, in version
// order, recorded in `schema_migration` (see migrate.ts).
//
// v1 is the baseline — the schema as it exists today. It is written to be
// idempotent (`CREATE TABLE IF NOT EXISTS`) so that adopting the framework on
// the already-provisioned production database is a safe no-op that simply
// records the baseline, while a fresh environment (local, a new Deploy) is
// provisioned identically. Because every later migration is guarded by the
// version table and runs exactly once, v2+ need not be idempotent.
export const migrations: Migration[] = [
  {
    version: 1,
    name: "baseline",
    // The production schema verbatim (SHOW CREATE TABLE), made idempotent with
    // IF NOT EXISTS and with the runtime AUTO_INCREMENT counter dropped. Tables
    // are ordered so foreign keys reference tables that already exist (user and
    // iteration before block and run). MariaDB dialect (`current_timestamp()`,
    // tinyint(1) booleans) to match the live database.
    up: `
      CREATE TABLE IF NOT EXISTS \`user\` (
        \`id\` char(36) NOT NULL,
        \`created\` timestamp NOT NULL DEFAULT current_timestamp(),
        \`name\` varchar(32) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL,
        \`rating\` float unsigned NOT NULL DEFAULT 1000,
        \`plays\` int(11) NOT NULL DEFAULT 0,
        PRIMARY KEY (\`id\`),
        KEY \`name\` (\`name\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      CREATE TABLE IF NOT EXISTS \`iteration\` (
        \`id\` int(10) unsigned NOT NULL AUTO_INCREMENT,
        \`created\` timestamp NOT NULL DEFAULT current_timestamp(),
        \`bricks\` tinyint(3) unsigned NOT NULL,
        \`power\` tinyint(3) unsigned NOT NULL,
        \`checkpoint_x\` float unsigned NOT NULL,
        \`checkpoint_y\` float unsigned NOT NULL,
        \`min\` float unsigned DEFAULT NULL,
        \`rated\` tinyint(1) NOT NULL DEFAULT 0,
        PRIMARY KEY (\`id\`),
        KEY \`created\` (\`created\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      CREATE TABLE IF NOT EXISTS \`block\` (
        \`iteration\` int(10) unsigned NOT NULL,
        \`x\` float unsigned NOT NULL,
        \`y\` float unsigned NOT NULL,
        \`kind\` enum('block','thunder') NOT NULL,
        KEY \`FK_blocks_iteration\` (\`iteration\`),
        CONSTRAINT \`FK_blocks_iteration\` FOREIGN KEY (\`iteration\`) REFERENCES \`iteration\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      CREATE TABLE IF NOT EXISTS \`run\` (
        \`user\` char(36) NOT NULL,
        \`iteration\` int(10) unsigned NOT NULL,
        \`created\` timestamp NOT NULL DEFAULT current_timestamp(),
        \`time\` float unsigned NOT NULL,
        \`daily\` tinyint(1) NOT NULL DEFAULT 0,
        \`void\` tinyint(1) NOT NULL DEFAULT 0,
        \`data\` text NOT NULL,
        KEY \`iteration_daily_void_time_idx\` (\`iteration\`,\`daily\`,\`void\`,\`time\`) USING BTREE,
        KEY \`user_daily_idx\` (\`user\`,\`daily\`) USING BTREE,
        KEY \`user_iteration_void_created_idx\` (\`user\`,\`iteration\`,\`void\`,\`created\`),
        CONSTRAINT \`FK_run_iteration\` FOREIGN KEY (\`iteration\`) REFERENCES \`iteration\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT \`FK_run_user\` FOREIGN KEY (\`user\`) REFERENCES \`user\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
  },
  {
    version: 2,
    name: "reslot-backfilled-iterations",
    // Widening the ensure-iterations window from 14 to 31 days back-generated the
    // June 4–18 dailies, but they landed at ids 155–169 — *above* the existing
    // ids (which start at 128), even though their dates are earlier. Anything that
    // orders by id then sees these past days as "future", so they wouldn't surface
    // until the id cursor caught up. Reslot them into the free range ending at 127
    // (155→113 … 169→127, i.e. id-42) so id order matches date order again.
    //
    // `block.iteration` (and `run.iteration`) are ON UPDATE CASCADE, so moving the
    // iteration ids carries their blocks along automatically — no separate update
    // is needed, and there are no runs on these dailies. Source (155–169) and
    // target (113–127) ranges are disjoint, so no row collides mid-statement.
    //
    // Keyed to the exact production ids; on any other database (fresh/local) those
    // ids don't exist, so this is a 0-row no-op, consistent with run-once v2+.
    up: `
      UPDATE \`iteration\`
      SET \`id\` = \`id\` - 42
      WHERE \`id\` BETWEEN 155 AND 169;`,
  },
];

// Fails fast on an ill-formed migration list: versions must be unique and form a
// contiguous run starting at 1, so "apply everything above the current version"
// can never silently skip a gap.
export const validateMigrations = (all: Migration[] = migrations) => {
  const sorted = [...all].sort((a, b) => a.version - b.version);
  sorted.forEach((m, i) => {
    if (m.version !== i + 1) {
      throw new Error(
        `migrations must be contiguous from 1; expected ${
          i + 1
        }, got ${m.version} (${m.name})`,
      );
    }
  });
  return sorted;
};

// The migrations that still need to run against a database at `current`, in
// order. Pure so the sequencing is unit-testable without a database.
export const pendingMigrations = (
  current: number,
  all: Migration[] = migrations,
) => validateMigrations(all).filter((m) => m.version > current);
