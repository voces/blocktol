// The one place a notification is created: persist the in-app row, then, if the
// recipient's setting allows, fan out Web Push to their devices. Push is
// best-effort (a dead endpoint is pruned, any other failure swallowed), so a
// push never fails notification creation. Callers must AWAIT these: the
// shutdown drain waits only for in-flight requests, so work left running after
// the response dies with a deploy's restart.

import {
  type DailyFinalData,
  type LostTopData,
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
  type PushSubscriptionRow,
  upsertLostTop,
} from "../db/notification.ts";
import { getUserSettings } from "../db/user.ts";
import { errText, log } from "./logging.ts";
import { pushConfigured, sendPush, sha256hex } from "./webpush.ts";

type Day = [number, number, number];

const pad = (n: number) => String(n).padStart(2, "0");

// The lock-screen payload the service worker renders (see public/sw.js). `tag`
// coalesces repeats of the same kind+iteration instead of stacking them.
const payloadFor = (
  kind: "lost_top" | "daily_final",
  iteration: number,
  day: Day,
  data: LostTopData | DailyFinalData,
  // The recipient device's locale (null: the server's own); the copy's numbers
  // and date render in it.
  locale: string | null,
) => {
  // A malformed stored locale makes Intl throw; render that device's copy in
  // the server's default rather than failing the batch it belongs to.
  let text;
  try {
    text = notificationText({ kind, day, data }, locale ?? undefined);
  } catch {
    text = notificationText({ kind, day, data });
  }
  const { title, body } = text;
  // Deep link to the day's permalink (client/store/notifNav.ts); `?board`
  // selects PB for a lost top, Daily for a finalized daily.
  const [y, m, d] = day;
  const board = kind === "lost_top" ? "pb" : "daily";
  const url = `/${y}${pad(m)}${pad(d)}?board=${board}`;
  return JSON.stringify({ title, body, tag: `${kind}:${iteration}`, url });
};

// Cap on push requests in flight at once.
const PUSH_CONCURRENCY = 16;

// Send `payload` to one subscription; prune it if the push service says gone.
const sendOne = async (sub: PushSubscriptionRow, payload: string) => {
  try {
    const res = await sendPush(sub, payload);
    if (res.gone) {
      // A device's last subscription dying is when its player silently stops
      // receiving while the toggles still read "on"; this line is the only
      // trace of it.
      log.info("push subscription pruned", {
        status: res.status,
        endpoint: sub.endpoint.slice(0, 60),
      });
      await deleteSubscription(await sha256hex(sub.endpoint)).catch(() => {});
    }
  } catch (err) {
    log.error("push fan-out error", { error: errText(err) });
  }
};

// Run `tasks` with at most `limit` in flight.
const pool = async (tasks: (() => Promise<void>)[], limit: number) => {
  let i = 0;
  const worker = async () => {
    while (i < tasks.length) await tasks[i++]!();
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, worker),
  );
};

// "Someone passed your #1" for a single recipient. Fires once per passer until
// read: the ranked path calls this on each leading save, and an unread card
// from the same passer is left alone (no DB write, no repeat push). A different
// passer, or a re-pass after the card was read, resurfaces it and re-pushes.
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
    // Rendered per device so each gets its own locale.
    await pool(
      subs.map((s) => () =>
        sendOne(s, payloadFor("lost_top", iteration, day, data, s.locale))
      ),
      PUSH_CONCURRENCY,
    );
    // Counterpart to notifyDailyFinals' summary below; a successful send logs
    // nothing else. `pushes: 0` means opted in with no live subscription.
    log.info("lost-top notification", { iteration, pushes: subs.length });
  } catch (err) {
    log.error("notifyLostTop failed", { error: errText(err) });
  }
};

// "A daily you played is final" for every participant at once (the rating cron).
// Every ranked player gets the in-app row; only those who opted into push (one
// batched settings query) get a push. INSERT IGNORE makes a re-run a no-op.
export const notifyDailyFinals = async (
  iteration: number,
  day: Day,
  outcomes: { user: string; data: DailyFinalData }[],
) => {
  if (outcomes.length === 0) return;
  try {
    // In-app for everyone, whatever their push setting.
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
      const payload = payloadFor("daily_final", iteration, day, data, s.locale);
      return [() => sendOne(s, payload)];
    });
    await pool(tasks, PUSH_CONCURRENCY);
    log.info("daily-final notifications", {
      iteration,
      inApp: outcomes.length,
      pushes: tasks.length,
    });
  } catch (err) {
    log.error("notifyDailyFinals failed", { error: errText(err) });
  }
};
