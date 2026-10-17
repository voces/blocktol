import { pruneNotifications, pruneUnusedUsers } from "../db/retention.ts";
import { errText, log } from "./logging.ts";

// Notifications are about one day's result and the panel shows the newest 50
// (a daily player fills that in under a month), so 90 days is well past the
// point any is seen again.
export const NOTIFICATION_DAYS = 90;
// A profile with nothing in it (see pruneUnusedUsers) after a month is a
// one-off visit or a crawler.
export const UNUSED_USER_DAYS = 30;

const BATCH = 1000;
// Batches per sweep: a backlog drains over a few hours rather than holding the
// cron, and the tables stay small enough after that to clear in one batch.
const MAX_BATCHES = 20;

// Run `batch` until it deletes fewer than `size` rows (nothing left) or
// `maxBatches` have run. Returns the total deleted.
export const drain = async (
  batch: () => Promise<number>,
  size: number,
  maxBatches: number,
) => {
  let total = 0;
  for (let i = 0; i < maxBatches; i++) {
    const n = await batch();
    total += n;
    if (n < size) break;
  }
  return total;
};

// One retention sweep, from the hourly ensure-iterations cron. A failure is
// only logged — it must never get in the way of generation — and the next hour
// retries.
export const pruneStaleData = async () => {
  try {
    const notifications = await drain(
      () => pruneNotifications(NOTIFICATION_DAYS, BATCH),
      BATCH,
      MAX_BATCHES,
    );
    const users = await drain(
      () => pruneUnusedUsers(UNUSED_USER_DAYS, BATCH),
      BATCH,
      MAX_BATCHES,
    );
    if (notifications || users) {
      log.info("pruned stale data", { notifications, users });
    }
  } catch (err) {
    log.error("prune failed", { error: errText(err) });
  }
};
