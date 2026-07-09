// The one place a notification is created: gate on the recipient's setting,
// persist the in-app row, then fan out Web Push to their devices. Push is
// best-effort — a dead endpoint is pruned, any other failure is swallowed — so
// notification creation never fails because a push did. Callers must AWAIT these
// (this Deploy tears the isolate down after the response, so background work can
// be killed mid-flight).

import {
  DailyFinalData,
  LostTopData,
  notificationText,
} from "../../common/notifications.ts";
import { defaultSettings } from "../../common/settings.ts";
import {
  deleteSubscription,
  getLostTop,
  getSubscriptions,
  getSubscriptionsForUsers,
  getUsersSettings,
  insertDailyFinals,
  PushSubscriptionRow,
  upsertLostTop,
} from "../db/notification.ts";
import { getUserSettings } from "../db/user.ts";
import { log } from "./logging.ts";
import { pushConfigured, sendPush, sha256hex } from "./webpush.ts";

type Day = [number, number, number];

// The lock-screen payload the service worker renders (see sw.js). `tag` coalesces
// repeats of the same kind+day into one notification rather than stacking.
const payloadFor = (
  kind: "lost_top" | "daily_final",
  iteration: number,
  day: Day,
  data: LostTopData | DailyFinalData,
) => {
  const { title, body } = notificationText({ kind, day, data });
  return JSON.stringify({ title, body, tag: `${kind}:${iteration}`, url: "/" });
};

// At most this many push requests in flight at once during the daily fan-out.
const PUSH_CONCURRENCY = 16;

// Send `payload` to one subscription; prune it if the service says it's gone.
const sendOne = async (sub: PushSubscriptionRow, payload: string) => {
  try {
    const res = await sendPush(sub, payload);
    if (res.gone) {
      await deleteSubscription(await sha256hex(sub.endpoint)).catch(() => {});
    }
  } catch (err) {
    log.error("push fan-out error", err);
  }
};

// Run `tasks` with a bounded number in flight, so a big day's fan-out doesn't
// open thousands of sockets at once.
const pool = async (tasks: (() => Promise<void>)[], limit: number) => {
  let i = 0;
  const worker = async () => {
    while (i < tasks.length) await tasks[i++]();
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, worker),
  );
};

// "Someone passed your #1" for a single recipient. Fires once per passer until
// read: while the same player keeps building higher (the ranked path can call
// this on each leading save), an already-unread card from that same passer is
// left as-is — no DB churn, no repeated push. A different passer, or a re-pass
// after the recipient has read the last one, resurfaces the card and re-pushes.
export const notifyLostTop = async (
  user: string,
  iteration: number,
  day: Day,
  data: LostTopData,
) => {
  try {
    const settings = await getUserSettings(user);
    if (!settings.notifications.lostTop) return;
    const existing = await getLostTop(user, iteration);
    const fresh = !existing || existing.read || existing.passer !== data.passer;
    if (!fresh) return;
    await upsertLostTop(user, iteration, data);
    if (!pushConfigured()) return;
    const subs = await getSubscriptions(user).catch(() => []);
    const payload = payloadFor("lost_top", iteration, day, data);
    await pool(subs.map((s) => () => sendOne(s, payload)), PUSH_CONCURRENCY);
  } catch (err) {
    log.error("notifyLostTop failed", err);
  }
};

// "A daily you played is final" for every participant at once (the rating cron).
// Settings are read in one batched query; only opted-in players get a row (and a
// push). INSERT IGNORE means a re-run of the sweep is a no-op.
export const notifyDailyFinals = async (
  iteration: number,
  day: Day,
  outcomes: { user: string; data: DailyFinalData }[],
) => {
  if (outcomes.length === 0) return;
  try {
    const settingsByUser = await getUsersSettings(outcomes.map((o) => o.user));
    const def = defaultSettings();
    const allowed = outcomes.filter((o) =>
      (settingsByUser.get(o.user) ?? def).notifications.dailyFinal
    );
    await insertDailyFinals(iteration, allowed);

    if (!pushConfigured() || allowed.length === 0) return;
    const dataByUser = new Map(allowed.map((o) => [o.user, o.data]));
    const subs = await getSubscriptionsForUsers(allowed.map((o) => o.user));
    const tasks = subs.flatMap((s) => {
      const data = dataByUser.get(s.user);
      if (!data) return [];
      const payload = payloadFor("daily_final", iteration, day, data);
      return [() => sendOne(s, payload)];
    });
    await pool(tasks, PUSH_CONCURRENCY);
    log.info(
      "daily-final notifications",
      iteration,
      `(${allowed.length} players, ${tasks.length} pushes)`,
    );
  } catch (err) {
    log.error("notifyDailyFinals failed", err);
  }
};
