import {
  DailyFinalData,
  LostTopData,
  Notification,
  NotificationKind,
} from "../../common/notifications.ts";
import { parseSettings, Settings } from "../../common/settings.ts";
import { sql } from "./query.ts";

// A stored subscription's push-relevant fields (the encryption keys + endpoint).
export type PushSubscriptionRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

// One player's notifications, newest first, joined to the daily's calendar day
// so the client can render "Jul 6" / open that board without a second lookup.
// Capped — the panel pages the recent slice; older rows age out of view, not the
// table. `data` is the denormalized JSON written at creation.
export const listNotifications = (user: string, limit = 50) =>
  sql<
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
  `.then((rows) =>
    rows.flatMap((r): Notification[] => {
      let data: unknown;
      try {
        data = JSON.parse(r.data);
      } catch {
        return []; // a corrupt payload drops the row rather than crashing the list
      }
      // The kind determines the payload type; the columns are shared.
      const base = {
        id: Number(r.id),
        iteration: r.iteration,
        day: [r.y, r.m, r.d] as [number, number, number],
        createdAt: Number(r.created),
        read: !!r.read,
      };
      if (r.kind === "lost_top") {
        return [{ ...base, kind: "lost_top", data: data as LostTopData }];
      }
      if (r.kind === "daily_final") {
        return [{ ...base, kind: "daily_final", data: data as DailyFinalData }];
      }
      return []; // unknown kind (forward-compat): skip
    })
  );

export const unreadCount = (user: string) =>
  sql<{ count: number }[]>`
    SELECT COUNT(1) count
    FROM notification
    WHERE user = ${user} AND read_at IS NULL;
  `.then((r) => Number(r[0]?.count ?? 0));

// Mark every unread notification read (the "Mark all read" action). Scoped to
// the caller; a no-op when nothing's unread.
export const markAllRead = (user: string) =>
  sql`
    UPDATE notification
    SET read_at = current_timestamp()
    WHERE user = ${user} AND read_at IS NULL;
  `;

// Mark specific notifications read (opening one). Scoped to the caller so an id
// they don't own is ignored. Empty list is a no-op.
export const markRead = (user: string, ids: number[]) => {
  if (ids.length === 0) return Promise.resolve();
  return sql`
    UPDATE notification
    SET read_at = current_timestamp()
    WHERE user = ${user} AND read_at IS NULL AND id IN (${ids});
  `;
};

// Create-or-resurface the "lost top spot" notification for a day. The UNIQUE
// (user, iteration, kind) means a repeat pass on the same day updates the one
// row — refreshing the passer/times and bumping it back to unread and to the
// top — instead of stacking a second card.
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

// Bulk-create the day's "daily final" notifications, one per participant.
// INSERT IGNORE on the UNIQUE key makes re-running the rating sweep a no-op
// (a player already told keeps their read state). Empty list is a no-op.
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

// The settings blobs for a set of users, parsed — so the generator can gate a
// notification (and its push) on the recipient's toggle in one round trip
// rather than one read per user. Absent users default (both kinds on).
export const getUsersSettings = (users: string[]) => {
  if (users.length === 0) return Promise.resolve(new Map<string, Settings>());
  return sql<{ id: string; settings: string | null }[]>`
    SELECT id, settings FROM user WHERE id IN (${users});
  `.then((rows) =>
    new Map(rows.map((r) => [r.id, parseSettings(r.settings)] as const))
  );
};

// Store (or move) a push subscription. The endpoint's SHA-256 is the key, so a
// device that re-subscribes (or switches accounts via a move link) upserts its
// one row rather than duplicating. Keys refresh in case the browser rotated them.
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
      auth = VALUES(auth);
  `;

export const deleteSubscription = (endpointHash: string) =>
  sql`DELETE FROM push_subscription WHERE endpoint_hash = ${endpointHash};`;

export const getSubscriptions = (user: string) =>
  sql<PushSubscriptionRow[]>`
    SELECT endpoint, p256dh, auth FROM push_subscription WHERE user = ${user};
  `;

// Subscriptions for many users at once (the daily-final push fan-out), tagged
// with their owner so each push carries the right user's payload. Empty list is
// a no-op.
export const getSubscriptionsForUsers = (users: string[]) => {
  if (users.length === 0) {
    return Promise.resolve([] as (PushSubscriptionRow & { user: string })[]);
  }
  return sql<(PushSubscriptionRow & { user: string })[]>`
    SELECT user, endpoint, p256dh, auth
    FROM push_subscription
    WHERE user IN (${users});
  `;
};
