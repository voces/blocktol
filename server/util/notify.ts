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
const pad = (n: number) => String(n).padStart(2, "0");

const payloadFor = (
  kind: "lost_top" | "daily_final",
  iteration: number,
  day: Day,
  data: LostTopData | DailyFinalData,
) => {
  const { title, body } = notificationText({ kind, day, data });
  // Deep-link to the day's permalink (see store/notifNav.ts): the `/YYYYMMDD`
  // path opens that day, and `?board` selects the relevant sort (PB for a lost
  // top spot, Daily for a finalized daily).
  const [y, m, d] = day;
  const board = kind === "lost_top" ? "pb" : "daily";
  const url = `/${y}${pad(m)}${pad(d)}?board=${board}`;
  return JSON.stringify({ title, body, tag: `${kind}:${iteration}`, url });
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
    const existing = await getLostTop(user, iteration);
    const fresh = !existing || existing.read || existing.passer !== data.passer;
    if (!fresh) return;
    // In-app is unconditional; the setting gates PUSH only.
    await upsertLostTop(user, iteration, data);
    const settings = await getUserSettings(user);
    if (!settings.notifications.lostTop || !pushConfigured()) return;
    const subs = await getSubscriptions(user).catch(() => []);
    const payload = payloadFor("lost_top", iteration, day, data);
    await pool(subs.map((s) => () => sendOne(s, payload)), PUSH_CONCURRENCY);
  } catch (err) {
    log.error("notifyLostTop failed", err);
  }
};

// "A daily you played is final" for every participant at once (the rating cron).
// Every ranked player gets the in-app row; only players who opted PUSH in (read
// from one batched settings query) get a push. INSERT IGNORE means a re-run of
// the sweep is a no-op.
export const notifyDailyFinals = async (
  iteration: number,
  day: Day,
  outcomes: { user: string; data: DailyFinalData }[],
) => {
  if (outcomes.length === 0) return;
  try {
    // In-app for everyone who played ranked.
    await insertDailyFinals(iteration, outcomes);

    if (!pushConfigured()) return;
    const settingsByUser = await getUsersSettings(outcomes.map((o) => o.user));
    const def = defaultSettings();
    const pushable = outcomes.filter((o) =>
      (settingsByUser.get(o.user) ?? def).notifications.dailyFinal
    );
    if (pushable.length === 0) return;

    const dataByUser = new Map(pushable.map((o) => [o.user, o.data]));
    const subs = await getSubscriptionsForUsers(pushable.map((o) => o.user));
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
      `(${outcomes.length} in-app, ${tasks.length} pushes)`,
    );
  } catch (err) {
    log.error("notifyDailyFinals failed", err);
  }
};
