export type Migration = { version: number; name: string; up: string };

// Ordered schema migrations. Each runs once per database, in version order,
// recorded in `schema_migration` (see migrate.ts).
//
// ⚠️ These run on boot, and every push deploys: pushing a branch applies its
// migrations to the shared DEV database at once (the Deno Deploy preview), and
// merging to prod applies them to PRODUCTION. Nothing is run by hand. Read
// server/db/CLAUDE.md before adding one.
//
// v1 is the baseline, written with `CREATE TABLE IF NOT EXISTS` so it is a
// no-op on the already-provisioned production database and provisions a fresh
// one identically. Later migrations run once, so they need not be idempotent.
export const migrations: Migration[] = [
  {
    version: 1,
    name: "baseline",
    // The production schema (SHOW CREATE TABLE) with IF NOT EXISTS and the
    // runtime AUTO_INCREMENT counter dropped. Tables are ordered so foreign
    // keys reference existing tables. MariaDB dialect, matching the live
    // database.
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
    // Per-user preferences (theme, board zoom) as a JSON blob; see
    // common/settings.ts.
    up:
      "ALTER TABLE `user` ADD COLUMN IF NOT EXISTS `settings` text DEFAULT NULL;",
  },
  {
    version: 3,
    name: "run-ranked",
    // Records at start time whether a run is a *ranked* daily attempt: among
    // the user's first three runs on the iteration, on the iteration that is
    // the daily for the user's claimed local day (db/run.ts startRun).
    // Inferring it from DATE(run.created) = DATE(iteration.created) in server
    // time fails at the edges: a daily's legal window spans ~50h of server time
    // (UTC+14 reaches day D at D-1 10:00 UTC, UTC-12 leaves it at D+1 12:00
    // UTC), so offset players' attempts land on a neighbouring date. Only the
    // start request carries the timezone.
    //
    // The backfill has no claimed timezone to use, so it approximates with that
    // full window: the first three runs per (user, iteration) created inside
    // it. The self-join is on (user, iteration, created) because the table has
    // no primary key, so equal-timestamp ties may mark an extra run. IF NOT
    // EXISTS and a re-runnable UPDATE make it retry-safe if the batch dies
    // before the version row lands.
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
  {
    version: 4,
    name: "run-user-void-time-index",
    // Covering index for a player's all-time best build, `MAX(time) WHERE user
    // = ? AND void = FALSE` (the profile's bestBuild, getUserStats): a single
    // index range. The standings PB sort is per iteration and rides
    // iteration_daily_void_time_idx instead.
    up:
      "ALTER TABLE `run` ADD INDEX IF NOT EXISTS `user_void_time_idx` (`user`, `void`, `time`);",
  },
  {
    version: 5,
    name: "notifications",
    // In-app + push notifications. Two tables:
    //
    //  `notification` — one row per delivered notification, its payload
    //   denormalized as JSON at write time (common/notifications.ts) so later
    //   changes never rewrite history. `read_at` NULL means unread. UNIQUE
    //   (user, iteration, kind) is the dedupe key: a re-pass on the same day
    //   upserts the existing "lost top" row (back to unread) instead of
    //   stacking, and a re-run of the rating cron can't double a "daily final".
    //   Different kinds on one day coexist. FKs cascade.
    //
    //  `push_subscription` — a Web Push endpoint per installed client. The
    //   endpoint is unique but too long to index, so its SHA-256 hex is the
    //   primary key; a device that moves accounts re-upserts the endpoint onto
    //   its new user. p256dh/auth are the RFC 8291 keys (base64url).
    up: `
      CREATE TABLE IF NOT EXISTS \`notification\` (
        \`id\` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
        \`user\` char(36) NOT NULL,
        \`iteration\` int(10) unsigned NOT NULL,
        \`kind\` varchar(32) NOT NULL,
        \`data\` text NOT NULL,
        \`created\` timestamp NOT NULL DEFAULT current_timestamp(),
        \`read_at\` timestamp NULL DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`user_iteration_kind\` (\`user\`,\`iteration\`,\`kind\`),
        KEY \`user_created_idx\` (\`user\`,\`created\`),
        KEY \`FK_notification_iteration\` (\`iteration\`),
        CONSTRAINT \`FK_notification_user\` FOREIGN KEY (\`user\`) REFERENCES \`user\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT \`FK_notification_iteration\` FOREIGN KEY (\`iteration\`) REFERENCES \`iteration\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      CREATE TABLE IF NOT EXISTS \`push_subscription\` (
        \`endpoint_hash\` char(64) NOT NULL,
        \`user\` char(36) NOT NULL,
        \`endpoint\` text NOT NULL,
        \`p256dh\` varchar(255) NOT NULL,
        \`auth\` varchar(255) NOT NULL,
        \`created\` timestamp NOT NULL DEFAULT current_timestamp(),
        PRIMARY KEY (\`endpoint_hash\`),
        KEY \`user_idx\` (\`user\`),
        CONSTRAINT \`FK_push_user\` FOREIGN KEY (\`user\`) REFERENCES \`user\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
  },
  {
    version: 6,
    name: "user-locale",
    // Server-rendered copy (push text built in the rating cron / notifier) has
    // no viewer to key formatting off, so each user's BCP-47 locale is
    // recorded, captured when a device subscribes to push. It belongs to the
    // user, not the device, so it is not on push_subscription. NULL until a
    // locale is seen; the push path then falls back to the runtime locale. A
    // canonical tag is well under 35 chars.
    up: "ALTER TABLE `user` ADD COLUMN `locale` varchar(35) NULL DEFAULT NULL;",
  },
  {
    version: 7,
    name: "run-pinned",
    // Player-pinned runs: a pinned run floats to the top of the player's OWN
    // Attempts panel. A per-player bookmark, not a leaderboard concept.
    //
    // The panel merges runs that built the identical maze into one ×N row, so a
    // pin toggles the whole maze-group (db/run.ts setRunPinned), keeping the
    // flag consistent however the merge picks its representative.
    up:
      "ALTER TABLE `run` ADD COLUMN IF NOT EXISTS `pinned` tinyint(1) NOT NULL DEFAULT 0;",
  },
  {
    version: 8,
    name: "run-client-id",
    // Free play commits in a single INSERT (db/run.ts insertFreePlayRun); the
    // client builds and times the 60s window locally. With no prior row to flip
    // non-void, a lost-response retry could duplicate the run, so the commit
    // carries a client-generated per-attempt id and the INSERT is guarded on it
    // (NOT EXISTS), which makes the retry idempotent.
    //
    // NULL for legacy rows, ranked runs, and free-play runs written by old
    // cached clients through the flip-void path. A UUID is 36 chars; 64 leaves
    // room.
    up:
      "ALTER TABLE `run` ADD COLUMN IF NOT EXISTS `client_id` varchar(64) NULL DEFAULT NULL;",
  },
  {
    version: 9,
    name: "pb-announcement",
    // Backs the Discord "top PB" post (util/pbBoard.ts): one row per iteration
    // holding the message posted for the day's best-build record, so a later
    // build can PATCH it when players match the top. `top_time` is DECIMAL, not
    // the run table's float, so it reads back as the exact two-decimal value
    // and the tie-equality test doesn't drift. `top_user` is the record holder:
    // a higher top by a NEW holder posts fresh, the same holder improving edits
    // the standing message. `holders` is the count of players at the top,
    // diffed to skip a redundant edit.
    up: `
      CREATE TABLE IF NOT EXISTS \`pb_announcement\` (
        \`iteration\` int(10) unsigned NOT NULL,
        \`message_id\` varchar(32) NOT NULL,
        \`top_time\` decimal(6,2) unsigned NOT NULL,
        \`top_user\` char(36) NOT NULL,
        \`holders\` int(10) unsigned NOT NULL DEFAULT 1,
        PRIMARY KEY (\`iteration\`),
        CONSTRAINT \`FK_pb_announcement_iteration\` FOREIGN KEY (\`iteration\`) REFERENCES \`iteration\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
  },
  {
    version: 10,
    name: "pb-announcement-announced-at",
    // When the standing "top PB" post was created (util/pbBoard.ts). A
    // same-holder improvement EDITS the post unless it lands more than
    // PB_EDIT_WINDOW_MS later, when it posts fresh, so the gate needs the
    // post's age: set on each (re)post, untouched on an edit. The DEFAULT backs
    // rows v9 already wrote.
    up:
      "ALTER TABLE `pb_announcement` ADD COLUMN IF NOT EXISTS `announced_at` timestamp NOT NULL DEFAULT current_timestamp();",
  },
  {
    version: 11,
    name: "pb-top-marker",
    // Replaces pb_announcement with pb_top, a minimal dedup marker of who holds
    // the announced top of an iteration's PB board (util/pbBoard.ts). The post
    // fires on a change of top HOLDER (a record-break, or the day's first PB)
    // and never edits, so message id, tie count and edit window are dropped
    // (v12 and v13 later restore them).
    up: `
      DROP TABLE IF EXISTS \`pb_announcement\`;

      CREATE TABLE IF NOT EXISTS \`pb_top\` (
        \`iteration\` int(10) unsigned NOT NULL,
        \`top_user\` char(36) NOT NULL,
        PRIMARY KEY (\`iteration\`),
        CONSTRAINT \`FK_pb_top_iteration\` FOREIGN KEY (\`iteration\`) REFERENCES \`iteration\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
  },
  {
    version: 12,
    name: "pb-top-edit-window",
    // Restores same-holder editing on the top-PB post: a player improving their
    // own lead EDITS the standing message within a 12h window, else posts fresh
    // (util/pbBoard.ts). Needs the message id, top time and window anchor on
    // pb_top. Nullable because v11 rows hold only top_user; a null message
    // falls back to a fresh post. `top_time` is DECIMAL so it reads back exact.
    up: `
      ALTER TABLE \`pb_top\`
        ADD COLUMN IF NOT EXISTS \`message_id\` varchar(32) NULL DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS \`top_time\` decimal(6,2) unsigned NULL DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS \`announced_at\` timestamp NULL DEFAULT NULL;`,
  },
  {
    version: 13,
    name: "pb-top-holders",
    // Restores tie tracking on the top-PB post: a build matching the announced
    // top EDITS the message with the tie count, and the holder later breaking
    // that tie posts FRESH (decidePbAction in util/pbBoard.ts). Both need the
    // count of players at the top. DEFAULT 1 backs existing rows (a sole
    // holder).
    up:
      "ALTER TABLE `pb_top` ADD COLUMN IF NOT EXISTS `holders` int(10) unsigned NOT NULL DEFAULT 1;",
  },
  {
    version: 14,
    name: "iteration-date-unique",
    // A puzzle belongs to a calendar DATE, and every read already keys off
    // DATE()/YEAR()/MONTH()/DAY() of `created`. Narrowing it to DATE and making
    // it UNIQUE makes the database the mutex for daily generation: the
    // on-demand backfill (`ensureDailyIterationId` in util/newIteration.ts,
    // needed because Deno Deploy previews don't run the `ensure-iterations`
    // cron) can race across isolates, and the loser's INSERT is rejected and
    // re-reads the winner's row.
    //
    // The DATE narrowing collapses historical same-day timestamps; the
    // self-join then deletes all but the lowest id per date (the id reads
    // already resolved to via `ORDER BY id LIMIT 1`), cascading to
    // block/run/notification/pb_top. Then the plain KEY `created` is replaced
    // by a UNIQUE one of the same name in one ALTER.
    up: `
      ALTER TABLE \`iteration\` MODIFY COLUMN \`created\` date NOT NULL;

      DELETE i FROM \`iteration\` i
      JOIN \`iteration\` lo ON lo.created = i.created AND lo.id < i.id;

      ALTER TABLE \`iteration\` DROP KEY \`created\`, ADD UNIQUE KEY \`created\` (\`created\`);`,
  },
  {
    version: 15,
    name: "flag",
    // Player-placed flags: the manual checkpoints of the splits tape
    // (common/splits.ts). A flag belongs to the BOARD, not a run, so the key is
    // (user, iteration) and the whole set lives in one column, as a run's maze
    // does (util/flags.ts). Reads and writes are always the whole set.
    //
    // Both FKs cascade on UPDATE as well as DELETE: erasure
    // (db/deleteAccount.ts) ROTATES `user.id`, and every table keyed by it must
    // follow.
    up: `
      CREATE TABLE IF NOT EXISTS \`flag\` (
        \`user\` char(36) NOT NULL,
        \`iteration\` int(10) unsigned NOT NULL,
        \`data\` varchar(255) NOT NULL,
        PRIMARY KEY (\`user\`,\`iteration\`),
        KEY \`FK_flag_iteration\` (\`iteration\`),
        CONSTRAINT \`FK_flag_user\` FOREIGN KEY (\`user\`) REFERENCES \`user\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT \`FK_flag_iteration\` FOREIGN KEY (\`iteration\`) REFERENCES \`iteration\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
  },
  {
    version: 16,
    name: "user-name-utf8mb4",
    // `user.name` was the one column still on utf8mb3 (from v1), which can't
    // hold a 4-byte character, so an emoji display name failed the rename.
    // Converts it to utf8mb4 / utf8mb4_unicode_ci with type, length,
    // nullability and default unchanged. varchar(32) counts characters in
    // either charset, so no name is truncated, and the `name` index stays under
    // InnoDB's key limit.
    up:
      "ALTER TABLE `user` MODIFY COLUMN `name` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL;",
  },
  {
    version: 17,
    name: "drop-flag",
    // Drops v15's `flag` table, which held each player's per-board flags for
    // the splits feature, which is gone; nothing reads or writes it.
    up: "DROP TABLE IF EXISTS `flag`;",
  },
];

// ── Editing an already-applied migration (read before you change one above) ──
//
// The runner keys off `version` alone: once a version is recorded in
// `schema_migration` it NEVER runs again, even if its `up` is edited. An edit
// reaches only databases that haven't applied it; one that ran the OLD `up`
// keeps the old schema. (v6 first added `push_subscription.locale`, was
// rewritten to `user.locale`, and dev, which had applied the original, ended up
// with the stray column and none of the new one.)
//
// The rule is APPEND-ONLY: never modify a shipped migration, add a later one
// that fixes it forward. Every database stays convergent, at the cost of
// pre-merge scratch work (an add, then a drop) in the permanent history.
//
// Exception, while a migration has only ever reached DEV: edit it in place and
// restore dev by hand (run the drop/add DDL, realign its `schema_migration`
// name) so a fresh migrate and dev agree. Once a migration has reached PROD,
// append only.

// Throws unless versions are unique and contiguous from 1, so "apply everything
// above the current version" can't skip a gap.
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
