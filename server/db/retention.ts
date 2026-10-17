import { ExecResult, sql } from "./query.ts";

// Data nothing reads any more, deleted in bounded batches by the hourly
// ensure-iterations cron (util/retention.ts). Each call deletes at most `limit`
// rows and returns how many it did, so a first sweep over a large backlog
// stays well inside the 3s query timeout and simply continues next hour.
// Both are idempotent (re-deleting finds nothing), so they ride `sql`'s retry.

// In-app notifications older than `days`. The panel shows the newest 50 and
// each one is about a single day's result, so an old row is never seen again.
// No index on `created` alone: the scan is over a table this keeps small.
export const pruneNotifications = (days: number, limit: number) =>
  sql<ExecResult>`
    DELETE FROM notification
    WHERE created < NOW() - INTERVAL ${days} DAY
    LIMIT ${limit};
  `.then((r) => r.affectedRows);

// Profiles that never did anything: every first boot seeds a `user` row
// (createOrUpdateUser), so one-off visitors and crawlers pile up. A row goes
// once it is older than `days` and holds nothing — no runs (void included, so a
// started attempt keeps it), flags, push subscriptions, settings or locale, and
// isn't named by `pb_top.top_user` (no FK). The name must be the seeded
// lower-case adjective+noun (common/random/name.ts) or absent; BINARY makes
// the regexp case-sensitive under the column's _ci collation, so a chosen name
// with any capital, digit or space is kept. There is no last-seen column, so
// `created` is the age: a device still visiting just gets a fresh row (and a
// new random name) on its next boot. Notifications cascade on the FK.
export const pruneUnusedUsers = (days: number, limit: number) =>
  sql<ExecResult>`
    DELETE FROM user
    WHERE created < NOW() - INTERVAL ${days} DAY
      AND settings IS NULL
      AND locale IS NULL
      AND (name IS NULL OR BINARY name REGEXP '^[a-z]+$')
      AND NOT EXISTS (SELECT 1 FROM run WHERE run.user = user.id)
      AND NOT EXISTS (SELECT 1 FROM flag WHERE flag.user = user.id)
      AND NOT EXISTS (
        SELECT 1 FROM push_subscription p WHERE p.user = user.id
      )
      AND NOT EXISTS (SELECT 1 FROM pb_top WHERE pb_top.top_user = user.id)
    LIMIT ${limit};
  `.then((r) => r.affectedRows);
