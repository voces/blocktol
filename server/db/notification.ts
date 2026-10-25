import type {
  DailyFinalData,
  LostTopData,
  Notification,
  NotificationKind,
} from "../../common/notifications.ts";
import { parseSettings, type Settings } from "../../common/settings.ts";
import { sql } from "./query.ts";

// A stored subscription's push fields (endpoint + keys), joined to its owner's
// BCP-47 `locale` for the push copy. Null falls back to the runtime locale.
export type PushSubscriptionRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
  locale: string | null;
};

// One player's notifications, newest first, joined to the daily's calendar day
// so the client can render it and open that board without a second lookup.
// Capped to the recent slice; older rows stay in the table. `data` is the JSON
// denormalized at creation.
export const listNotifications = async (
  user: string,
  limit = 50,
): Promise<Notification[]> => {
  const rows = await sql<
    {
      id: number;
      kind: NotificationKind;
      iteration: number;
      data: string;
      created: number;
      read: number;
      y: number;
      m: number;
      d: number;
    }[]
  >`
    SELECT
      n.id id,
      n.kind kind,
      n.iteration iteration,
      n.data data,
      UNIX_TIMESTAMP(n.created) * 1000 created,
      (n.read_at IS NOT NULL) \`read\`,
      YEAR(i.created) y, MONTH(i.created) m, DAY(i.created) d
    FROM notification n
    JOIN iteration i ON i.id = n.iteration
    WHERE n.user = ${user}
    ORDER BY n.created DESC, n.id DESC
    LIMIT ${limit};
  `;

  const notifs = rows.flatMap((r): Notification[] => {
    let data: unknown;
    try {
      data = JSON.parse(r.data);
    } catch {
      return []; // a corrupt payload drops the row, not the list
    }
    // The kind determines the payload type; the columns are shared.
    const base = {
      id: Number(r.id),
      iteration: r.iteration,
      day: [r.y, r.m, r.d] as [number, number, number],
      createdAt: Number(r.created),
      read: !!r.read,
      reclaimed: null, // filled in below for reclaimed lost-tops
    };
    if (r.kind === "lost_top") {
      return [{ ...base, kind: "lost_top", data: data as LostTopData }];
    }
    if (r.kind === "daily_final") {
      return [{ ...base, kind: "daily_final", data: data as DailyFinalData }];
    }
    return []; // unknown kind (forward-compat): skip
  });

  // A "lost top" is reclaimed once the viewer holds or ties the top of that
  // day's PB board again. Computed live from the current field, so there is no
  // stored flag to keep in sync. Only lost-tops can be.
  const lostIterations = [
    ...new Set(
      notifs.filter((n) => n.kind === "lost_top").map((n) => n.iteration),
    ),
  ];
  if (lostIterations.length === 0) return notifs;
  const reclaimed = await reclaimedIterations(user, lostIterations);
  return notifs.map((n) =>
    n.kind === "lost_top" && reclaimed.has(n.iteration)
      ? { ...n, reclaimed: reclaimed.get(n.iteration)! }
      : n
  );
};

// Of the given iterations, those where `user` holds or ties the top of the PB
// board (best build = MAX(time) over non-void runs, as in getIterationBests and
// the lost-top decision), tagged "solo" or "tied". A tie counts as reclaimed:
// only a strict pass costs the top, so getting level restores it.
const reclaimedIterations = (user: string, iterations: number[]) =>
  sql<{ iteration: number; tied: number }[]>`
    SELECT
      b.iteration iteration,
      (MAX(CASE WHEN b.user <> ${user} THEN b.t END) >=
        MAX(CASE WHEN b.user = ${user} THEN b.t END)) tied
    FROM (
      SELECT iteration, user, MAX(time) t
      FROM run
      WHERE iteration IN (${iterations}) AND void = FALSE
      GROUP BY iteration, user
    ) b
    GROUP BY b.iteration
    HAVING MAX(CASE WHEN b.user = ${user} THEN b.t END) >= MAX(b.t);
  `.then((rows) =>
    new Map(
      rows.map((r) => [r.iteration, r.tied ? "tied" : "solo"] as const),
    )
  );

// The bell badge count: unread notifications, EXCLUDING reclaimed lost-tops,
// which the panel greys out too. The correlated check mirrors
// reclaimedIterations: a lost-top counts only while the viewer's best build is
// still short of the field's best.
export const unreadCount = (user: string) =>
  sql<{ count: number }[]>`
    SELECT COUNT(1) count
    FROM notification n
    WHERE n.user = ${user}
      AND n.read_at IS NULL
      AND (
        n.kind <> 'lost_top'
        OR (
          SELECT MAX(CASE WHEN r.user = ${user} THEN r.time END) < MAX(r.time)
          FROM run r
          WHERE r.iteration = n.iteration AND r.void = FALSE
        )
      );
  `.then((r) => Number(r[0]?.count ?? 0));

// Marks every unread notification of the caller read ("Mark all read").
export const markAllRead = (user: string) =>
  sql`
    UPDATE notification
    SET read_at = current_timestamp()
    WHERE user = ${user} AND read_at IS NULL;
  `;

// Marks specific notifications read. Scoped to the caller, so ids they don't
// own are ignored. Empty list is a no-op.
export const markRead = (user: string, ids: number[]) => {
  if (ids.length === 0) return Promise.resolve();
  return sql`
    UPDATE notification
    SET read_at = current_timestamp()
    WHERE user = ${user} AND read_at IS NULL AND id IN (${ids});
  `;
};

// Marks a day's notification of a kind read. A push deep-link
// (`/YYYYMMDD?board=...`) carries the day and board, not the notification id.
export const markReadByDay = (
  user: string,
  iteration: number,
  kind: NotificationKind,
) =>
  sql`
    UPDATE notification
    SET read_at = current_timestamp()
    WHERE user = ${user}
      AND iteration = ${iteration}
      AND kind = ${kind}
      AND read_at IS NULL;
  `;

// The existing "lost top" notification for a day, if any: its passer and
// whether it was read. The generator fires once per passer until read, so a
// player building higher on every save (the ranked path can call in a tight
// loop) doesn't re-push each time.
export const getLostTop = (user: string, iteration: number) =>
  sql<{ data: string; unread: number }[]>`
    SELECT data, (read_at IS NULL) unread
    FROM notification
    WHERE user = ${user} AND iteration = ${iteration} AND kind = 'lost_top'
    LIMIT 1;
  `.then((r) => {
    if (!r[0]) return null;
    try {
      const passer = (JSON.parse(r[0].data) as { passer?: string }).passer;
      return { passer: passer ?? "", read: !r[0].unread };
    } catch {
      return { passer: "", read: !r[0].unread };
    }
  });

// Creates or resurfaces the "lost top" notification for a day. UNIQUE (user,
// iteration, kind) makes a repeat pass update the one row (new passer/times,
// back to unread and to the top) instead of stacking a second card.
export const upsertLostTop = (
  user: string,
  iteration: number,
  data: LostTopData,
) =>
  sql`
    INSERT INTO notification (user, iteration, kind, data)
    VALUES (${user}, ${iteration}, 'lost_top', ${JSON.stringify(data)})
    ON DUPLICATE KEY UPDATE
      data = VALUES(data),
      created = current_timestamp(),
      read_at = NULL;
  `;

// Bulk-creates the day's "daily final" notifications, one per participant.
// INSERT IGNORE on the UNIQUE key makes a re-run of the rating sweep a no-op
// (read state is kept). Empty list is a no-op.
export const insertDailyFinals = (
  iteration: number,
  finals: { user: string; data: DailyFinalData }[],
) => {
  if (finals.length === 0) return Promise.resolve();
  const values = finals.map((
    f,
  ) => [f.user, iteration, "daily_final", JSON.stringify(f.data)]);
  return sql`
    INSERT IGNORE INTO notification (user, iteration, kind, data)
    VALUES ${values};
  `;
};

// Parsed settings for a set of users in one round trip, so the generator can
// gate a notification and its push on each recipient's toggle. Absent users get
// the defaults (both kinds on).
export const getUsersSettings = (users: string[]) => {
  if (users.length === 0) return Promise.resolve(new Map<string, Settings>());
  return sql<{ id: string; settings: string | null }[]>`
    SELECT id, settings FROM user WHERE id IN (${users});
  `.then((rows) =>
    new Map(rows.map((r) => [r.id, parseSettings(r.settings)] as const))
  );
};

// At most this many push subscriptions per user, so one id can't grow the table
// (and every fan-out) without bound. Real players have a handful of devices.
export const MAX_SUBSCRIPTIONS_PER_USER = 10;

// Stores or moves a push subscription. The endpoint's SHA-256 is the key, so a
// device that re-subscribes or switches accounts upserts its one row. Keys
// refresh in case the browser rotated them.
//
// `created` is bumped on every upsert, so it reads as "last registered" (the
// client re-registers on every boot). The second statement prunes the user's
// stalest rows past the cap, ordering this row first so the device registering
// now is never the one dropped. Both statements are idempotent, so the
// retrying `sql` is safe. (The derived table is how MariaDB accepts a LIMIT in
// an IN subquery.)
export const upsertSubscription = (
  user: string,
  endpointHash: string,
  endpoint: string,
  p256dh: string,
  auth: string,
) =>
  sql`
    INSERT INTO push_subscription (endpoint_hash, user, endpoint, p256dh, auth)
    VALUES (${endpointHash}, ${user}, ${endpoint}, ${p256dh}, ${auth})
    ON DUPLICATE KEY UPDATE
      user = VALUES(user),
      endpoint = VALUES(endpoint),
      p256dh = VALUES(p256dh),
      auth = VALUES(auth),
      created = current_timestamp();
    DELETE FROM push_subscription
    WHERE user = ${user}
      AND endpoint_hash NOT IN (
        SELECT endpoint_hash FROM (
          SELECT endpoint_hash FROM push_subscription
          WHERE user = ${user}
          ORDER BY endpoint_hash = ${endpointHash} DESC, created DESC
          LIMIT ${MAX_SUBSCRIPTIONS_PER_USER}
        ) keep
      );
  `;

// Prunes a subscription the push service disowned (404/410), whoever owns it:
// the endpoint is dead.
export const deleteSubscription = (endpointHash: string) =>
  sql`DELETE FROM push_subscription WHERE endpoint_hash = ${endpointHash};`;

// A player dropping a subscription (unsubscribePush). Scoped to the caller, so
// knowing another's endpoint can't cut off their pushes.
export const deleteOwnSubscription = (user: string, endpointHash: string) =>
  sql`
    DELETE FROM push_subscription
    WHERE endpoint_hash = ${endpointHash} AND user = ${user};
  `;

export const getSubscriptions = (user: string) =>
  sql<PushSubscriptionRow[]>`
    SELECT ps.endpoint, ps.p256dh, ps.auth, u.locale
    FROM push_subscription ps
    JOIN user u ON u.id = ps.user
    WHERE ps.user = ${user};
  `;

// Subscriptions for many users at once (the daily-final fan-out), tagged with
// their owner. Empty list is a no-op.
export const getSubscriptionsForUsers = (users: string[]) => {
  if (users.length === 0) {
    return Promise.resolve([] as (PushSubscriptionRow & { user: string })[]);
  }
  return sql<(PushSubscriptionRow & { user: string })[]>`
    SELECT ps.user, ps.endpoint, ps.p256dh, ps.auth, u.locale
    FROM push_subscription ps
    JOIN user u ON u.id = ps.user
    WHERE ps.user IN (${users});
  `;
};
