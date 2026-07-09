import { signal } from "@preact/signals";
import { api, MessageMap } from "../api.ts";
import { refreshMonth } from "./dailyItems.ts";
import { keyedQuery } from "./query.ts";
import { refreshStandings, todayIteration } from "./standings.ts";

export type NotificationsData = MessageMap["getNotifications"];
export type NotificationItem = NotificationsData["items"][number];

// The signed-in user's notifications and unread count, behind the header bell.
// Warmed on boot and refreshed when the panel opens; components reading these
// signals re-render as they land.
export const notifications = signal<NotificationItem[]>([]);
export const unreadCount = signal<number>(0);

// Bumped whenever the unread count RISES after the first load — a notification
// just arrived while the app was open (via the focused-push channel below or the
// poll). The bell watches it to give a quick swing; the initial load doesn't
// bump, so opening the app to existing unread doesn't swing.
export const bellNudge = signal<number>(0);

// The iterations a just-arrived notification touched, with a monotonic nonce so
// the open board can regrade its runs (a lost-top / finalized daily moved the
// field, so the % / hue ramp needs recomputing). The calendar and standings are
// refreshed here directly; the runs live in game state, so a component watches
// this signal.
export const regradedIterations = signal<
  { nonce: number; iterations: number[] }
>({ nonce: 0, iterations: [] });

let loaded = false;
let lastSeenId = 0;

const monthIdxOf = (day: readonly [number, number, number]) =>
  day[0] * 12 + (day[1] - 1);

const apply = (data: NotificationsData) => {
  const prevUnread = unreadCount.peek();
  notifications.value = data.items;
  unreadCount.value = data.unread;

  const maxId = data.items.reduce((m, n) => Math.max(m, n.id), 0);
  if (!loaded) {
    // Baseline the first load — existing notifications don't swing or regrade.
    lastSeenId = maxId;
    loaded = true;
    return;
  }

  if (data.unread > prevUnread) bellNudge.value++;

  // Notifications that arrived since we last looked (a push, or a poll after
  // being away). Each moved its day's field, so regrade what shows it: the
  // calendar month, that day's standings, and — via the signal — the open
  // board's runs.
  const fresh = data.items.filter((n) => n.id > lastSeenId);
  if (fresh.length === 0) return;
  lastSeenId = maxId;
  for (const n of fresh) refreshMonth(monthIdxOf(n.day));
  const affected = [...new Set(fresh.map((n) => n.iteration))];
  for (const it of affected) {
    // Today's standings are cached under "today", past days under the id.
    refreshStandings(it === todayIteration.peek() ? undefined : it);
  }
  regradedIterations.value = {
    nonce: regradedIterations.peek().nonce + 1,
    iterations: affected,
  };
};

// Coalesce concurrent asks onto one request per freshness window; a failed fetch
// frees the window so the next ask retries.
const fetchOnce = keyedQuery(async () => {
  const r = await api.getNotifications({});
  if (!r || "error" in r) throw new Error("failed to fetch notifications");
  apply(r);
  return r;
}, { staleMs: 20_000 });

// Fetch (or serve the fresh cache). Errors are swallowed — callers keep showing
// whatever was cached.
export const fetchNotifications = (): Promise<NotificationsData | undefined> =>
  fetchOnce(undefined).catch(() => undefined);

// Force a refetch (opening the panel onto possibly-stale data).
export const refreshNotifications = (): Promise<
  NotificationsData | undefined
> => {
  fetchOnce.bust(undefined);
  return fetchNotifications();
};

// Mark specific notifications read (opening them) or all when `ids` is omitted.
// Optimistic: flip locally right away, reconcile the count from the response.
export const markRead = async (ids?: number[]) => {
  const idSet = ids ? new Set(ids) : null;
  notifications.value = notifications.value.map((n) =>
    !n.read && (!idSet || idSet.has(n.id)) ? { ...n, read: true } : n
  );
  unreadCount.value = notifications.value.filter((n) => !n.read).length;
  try {
    const r = await api.markNotificationsRead(ids ? { ids } : {});
    if (r && !("error" in r)) unreadCount.value = r.unread;
  } catch {
    // Leave the optimistic state; the next fetch reconciles.
  }
};

// Mark a day's notification of a kind read — tapping its push deep-link counts
// as reading it, but the link carries the day + board, not the id, so the server
// resolves the match. Optimistic locally; reconcile the count from the response.
export const markReadForDay = async (
  iteration: number,
  kind: NotificationItem["kind"],
) => {
  notifications.value = notifications.value.map((n) =>
    !n.read && n.iteration === iteration && n.kind === kind
      ? { ...n, read: true }
      : n
  );
  unreadCount.value = notifications.value.filter((n) => !n.read).length;
  try {
    const r = await api.markNotificationsRead({ iteration, kind });
    if (r && !("error" in r)) unreadCount.value = r.unread;
  } catch {
    // Leave the optimistic state; the next fetch reconciles.
  }
};

// A daily's ranks lock ~37h after it starts and free-play passes happen live, so
// the bell can go stale on a long-open tab. A quiet poll keeps the badge honest
// without any push. Paused while the tab is hidden.
const POLL_MS = 90_000;
let timer = -1;
const tick = () => {
  if (document.visibilityState === "visible") refreshNotifications();
};
export const startNotificationsPolling = () => {
  clearInterval(timer);
  timer = setInterval(tick, POLL_MS);
  document.addEventListener("visibilitychange", tick);
};

// When a push arrives while the app is on screen, the service worker forwards it
// here (see sw.js) instead of showing a redundant system banner. Refresh the
// bell right away — the rising unread count nudges its ring — rather than
// waiting on the poll.
export const initPushChannel = () => {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("message", (e) => {
    if ((e.data as { type?: string } | null)?.type === "notification") {
      refreshNotifications();
    }
  });
};
