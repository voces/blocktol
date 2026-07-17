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
  {
    version: 4,
    name: "run-user-void-time-index",
    // Covering index for a player's all-time best build — `MAX(time) WHERE
    // user = ? AND void = FALSE` (the profile's bestBuild, getUserStats): the
    // leftmost `user` seeks, `void` filters, and `time` is read for the MAX, so
    // it's a single index range. (The standings PB sort is scoped per
    // iteration and rides iteration_daily_void_time_idx instead.) IF NOT EXISTS
    // keeps it safe if the index was ever added out of band. MariaDB dialect.
    up:
      "ALTER TABLE `run` ADD INDEX IF NOT EXISTS `user_void_time_idx` (`user`, `void`, `time`);",
  },
  {
    version: 5,
    name: "notifications",
    // In-app + push notifications. Two tables:
    //
    //  `notification` — one row per delivered notification, its payload fully
    //   denormalized as JSON at write time (see common/notifications.ts) so a
    //   later change to the field never rewrites history. `read_at` NULL means
    //   unread. The UNIQUE (user, iteration, kind) is the dedupe key: at most one
    //   notification per player per day per kind — a re-pass on the same day
    //   upserts the existing "lost top" row (bumping it back to unread) rather
    //   than stacking, and a re-run of the rating cron can't double a
    //   "daily final". A player can still hold BOTH kinds for one day (different
    //   kind). FKs cascade so deleting a user/iteration clears their notifications.
    //
    //  `push_subscription` — a Web Push endpoint per installed client. The
    //   endpoint is globally unique but too long to index directly, so its
    //   SHA-256 hex is the primary key; a device that moves accounts re-upserts
    //   the same endpoint onto its new user. p256dh/auth are the RFC 8291
    //   encryption keys (base64url).
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
    // Server-rendered copy (push text, built in the rating cron / notifier) has
    // no viewer to key formatting off. Record each user's BCP-47 locale —
    // captured passively when a device subscribes to push — so a push renders
    // its numbers/date in the user's locale instead of the server's, and so any
    // later server-rendered surface can reuse it. It's a property of the user,
    // not a device, so it lives here rather than on push_subscription. NULL
    // until we've seen a locale for the user; the push path falls back to the
    // runtime locale then. Short varchar: a canonicalised tag is well under 35.
    up: "ALTER TABLE `user` ADD COLUMN `locale` varchar(35) NULL DEFAULT NULL;",
  },
  {
    version: 7,
    name: "run-pinned",
    // Player-pinned runs. A pinned run floats to the top of the player's OWN
    // runs panel (the Attempts list), ahead of the best/recent sort — it's a
    // per-player bookmark of their runs, not a leaderboard concept. A single
    // boolean per run row, default 0 (unpinned).
    //
    // The panel merges runs that built the identical maze into one ×N row, so a
    // pin toggles every run in that maze-group together (see db/run.ts
    // setRunPinned) — the flag stays consistent across the group however the
    // merge later picks its representative. IF NOT EXISTS keeps it safe if the
    // column was ever added out of band. MariaDB dialect.
    up:
      "ALTER TABLE `run` ADD COLUMN IF NOT EXISTS `pinned` tinyint(1) NOT NULL DEFAULT 0;",
  },
  {
    version: 8,
    name: "run-client-id",
    // Free play now commits in a single INSERT. It no longer calls startRun /
    // updateRun — the client builds and times the 60s window locally and only
    // touches the server once, at execution (see db/run.ts insertFreePlayRun and
    // the client run loop). With no prior row to flip non-void, a lost-response
    // retry of that commit could duplicate the run, so the commit carries a
    // client-generated per-attempt id and the INSERT is guarded on it
    // (NOT EXISTS) — making a retried free-play commit idempotent, the same
    // safety startRun/updateRun get from their own dedupes.
    //
    // NULL for every legacy row, for ranked runs (which still commit on build),
    // and for free-play runs written by old cached clients through the legacy
    // flip-void path. IF NOT EXISTS keeps it safe if added out of band. A UUID is
    // 36 chars; 64 leaves room. MariaDB dialect.
    up:
      "ALTER TABLE `run` ADD COLUMN IF NOT EXISTS `client_id` varchar(64) NULL DEFAULT NULL;",
  },
  {
    version: 9,
    name: "pb-announcement",
    // Backs the Discord "top PB" post (util/pbBoard.ts): one row per iteration
    // holding the message we posted for the day's current best-build record, so a
    // later build can PATCH that same message when players match the top rather
    // than posting anew. `top_time` is DECIMAL (not the run table's float) so it
    // reads back as the exact two-decimal value the game stores — a float would
    // drift and break the equality test that detects a tie of the current top.
    // `top_user` is the record holder's id: a strictly higher top by a NEW holder
    // posts a fresh message (a lead change), while the same holder improving their
    // own top edits the standing one — so one player's climb doesn't spam. Holders
    // is the count of players at that top, diffed to skip a redundant edit.
    // Cascades on the iteration FK like every other per-iteration table.
    // IF NOT EXISTS keeps it safe if the table was ever created out of band.
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
    // When the standing "top PB" post was created (util/pbBoard.ts). A same-holder
    // improvement normally EDITS that post — collapsing a 60s burst of leading
    // saves to one message — but if it lands more than PB_RECORD_RESET_MS later (a
    // return visit, not a burst) it posts a fresh message instead. That gate needs
    // the post's age, so record it: set to now on each (re)post, left untouched on
    // an edit, so the window is anchored at the post. Appended rather than folded
    // into v9 because v9 may already have run against the dev DB (the runner keys
    // off version alone and never re-runs an applied migration). DEFAULT
    // current_timestamp() backs any row v9 already wrote with a sane recent time.
    // IF NOT EXISTS keeps it safe if added out of band. MariaDB dialect.
    up:
      "ALTER TABLE `pb_announcement` ADD COLUMN IF NOT EXISTS `announced_at` timestamp NOT NULL DEFAULT current_timestamp();",
  },
  {
    version: 11,
    name: "pb-top-marker",
    // Replace pb_announcement (message id + editable post state for the old
    // post/edit Discord mechanism) with pb_top: a minimal dedup marker recording
    // who currently holds the announced top of an iteration's PB board (see
    // util/pbBoard.ts). The Discord post now fires on a change of top HOLDER — a
    // record-break, or the day's first PB — and never edits, so the message id,
    // tie count, and stale window are all gone. Appended (v9/v10 reached prod, so
    // they can't be edited in place). DROP/CREATE guarded so a re-run is a no-op.
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
    // Restore same-holder editing on the top-PB post: a player improving their own
    // lead EDITS the standing message within a 12h window, and posts a fresh one
    // past it (see util/pbBoard.ts). That needs the announced message + time + the
    // window anchor back on the pb_top marker (v11 kept only top_user). Nullable:
    // rows v11 already wrote have only top_user, and a null message just falls back
    // to a fresh post. `top_time` is DECIMAL so it reads back as the exact
    // two-decimal value (a float MAX would drift). MariaDB dialect; IF NOT EXISTS
    // keeps it safe if a column was added out of band.
    up: `
      ALTER TABLE \`pb_top\`
        ADD COLUMN IF NOT EXISTS \`message_id\` varchar(32) NULL DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS \`top_time\` decimal(6,2) unsigned NULL DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS \`announced_at\` timestamp NULL DEFAULT NULL;`,
  },
  {
    version: 13,
    name: "pb-top-holders",
    // Restore tie tracking on the top-PB post: someone matching the announced top
    // EDITS the message with the tie count, and the holder later breaking that tie
    // (improving past a shared record) posts a FRESH message rather than editing
    // (see util/pbBoard.ts's decidePbAction). Both need the count of players at the
    // announced top. DEFAULT 1 backs existing rows (a sole holder). MariaDB dialect.
    up:
      "ALTER TABLE `pb_top` ADD COLUMN IF NOT EXISTS `holders` int(10) unsigned NOT NULL DEFAULT 1;",
  },
];

// ── Editing an already-applied migration (read before you change one above) ──
//
// The runner keys off `version` alone: once a version is recorded in
// `schema_migration` it NEVER runs again, even if you edit its `up`. So editing
// a migration only reaches databases that haven't applied it yet — a database
// that already ran the OLD `up` keeps the old schema and never picks up the new,
// an awkward split. (This bit us once: v6 first added `push_subscription.locale`,
// was rewritten to `user.locale`, and the dev DB — which had already applied the
// original — ended up with the stray column and none of the new one.)
//
// The strictly-correct rule is APPEND-ONLY: never modify a shipped migration,
// only add a later one that fixes it forward. Every database stays convergent —
// at the cost of leaving pre-merge scratch work (an add, then a drop) in the
// permanent history.
//
// Pragmatic exception, while a migration has only ever reached DEV (not merged
// to prod): edit it in place and directly restore dev to match — hand-run the
// drop/add DDL against the dev DB and realign its `schema_migration` name — so a
// fresh migrate and dev agree with no scratch work. Once a migration has shipped
// to PROD, it's set in stone: append only.

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
