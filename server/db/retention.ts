import { type ExecResult, sql } from "./query.ts";

// Data nothing reads, deleted in bounded batches by the hourly
// ensure-iterations cron (util/retention.ts). Each call deletes at most `limit`
// rows and returns the count, so a large backlog stays inside the 3s query
// timeout and drains over several runs. Both are idempotent, so they ride
// `sql`'s retry.

// In-app notifications older than `days`: the panel shows the newest 50, so an
// old row is never seen again. `created` has no index of its own; the scan is
// over a table this keeps small.
export const pruneNotifications = (days: number, limit: number) =>
  sql<ExecResult>`
    DELETE FROM notification
    WHERE created < NOW() - INTERVAL ${days} DAY
    LIMIT ${limit};
  `.then((r) => r.affectedRows);

// Profiles that never did anything: every first boot seeds a `user` row
// (createOrUpdateUser), so one-off visitors and crawlers pile up. A row goes
// once older than `days` and holding nothing: no runs (void included, so a
// started attempt keeps it), push subscriptions, settings or locale, and
// not named by `pb_top.top_user` (no FK). The name must be absent or the seeded
// lower-case adjective+noun (common/random/name.ts); BINARY makes the regexp
// case-sensitive under the column's _ci collation, so a chosen name with a
// capital, digit or space is kept. With no last-seen column, `created` is the
// age: a returning device just gets a fresh row and random name. Notifications
// cascade on the FK.
export const pruneUnusedUsers = (days: number, limit: number) =>
  sql<ExecResult>`
    DELETE FROM user
    WHERE created < NOW() - INTERVAL ${days} DAY
      AND settings IS NULL
      AND locale IS NULL
      AND (name IS NULL OR BINARY name REGEXP '^[a-z]+$')
      AND NOT EXISTS (SELECT 1 FROM run WHERE run.user = user.id)
      AND NOT EXISTS (
        SELECT 1 FROM push_subscription p WHERE p.user = user.id
      )
      AND NOT EXISTS (SELECT 1 FROM pb_top WHERE pb_top.top_user = user.id)
    LIMIT ${limit};
  `.then((r) => r.affectedRows);
