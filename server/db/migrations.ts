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
    name: "user-settings",
    // Per-user preferences (theme, board zoom) as a JSON blob — see
    // common/settings.ts. IF NOT EXISTS (MariaDB) keeps it safe if a column was
    // ever added out of band.
    up:
      "ALTER TABLE `user` ADD COLUMN IF NOT EXISTS `settings` text DEFAULT NULL;",
  },
  {
    version: 3,
    name: "run-ranked",
    // Record at start time whether a run is a *ranked* daily attempt: among the
    // user's first three runs on the iteration, AND the iteration was the daily
    // for the user's claimed local day (see db/run.ts startRun). Ranked-ness was
    // previously inferred from DATE(run.created) = DATE(iteration.created) in
    // server time, which is wrong at the edges: a daily's legal window spans
    // ~50 hours of server time — UTC+14 reaches day D at D-1 10:00 UTC and
    // UTC-12 leaves it at D+1 12:00 UTC (the same window rateDailies' 37h close
    // waits out) — so offset players' attempts land on a neighbouring server
    // date. Only the start request, which carries the player's timezone, can
    // decide correctly, so the flag is written then and read everywhere else.
    //
    // The backfill approximates history with that full legal window (historic
    // starts didn't record the claimed timezone): the first three runs per
    // (user, iteration) created inside it. Runs join back on
    // (user, iteration, created) — the table has no primary key — so
    // equal-timestamp ties may mark an extra run, matching the old read
    // predicate's tie behaviour. IF NOT EXISTS plus a re-runnable UPDATE keep
    // the migration retry-safe if the batch dies before the version row lands.
    up: `
      ALTER TABLE \`run\` ADD COLUMN IF NOT EXISTS \`ranked\` tinyint(1) NOT NULL DEFAULT 0;

      UPDATE run r
      JOIN (
        SELECT user, iteration, created,
          ROW_NUMBER() OVER (PARTITION BY user, iteration ORDER BY created) rn
        FROM run
      ) x ON x.user = r.user AND x.iteration = r.iteration AND x.created = r.created
      JOIN iteration i ON i.id = r.iteration
      SET r.ranked = 1
      WHERE x.rn <= 3
        AND r.created >= DATE(i.created) - INTERVAL 14 HOUR
        AND r.created < DATE(i.created) + INTERVAL 36 HOUR;`,
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
