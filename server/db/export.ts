import { sql } from "./query.ts";

export type ExportUserRow = {
  id: string;
  name: string | null;
  rating: number;
  plays: number;
  settings: string | null;
  locale: string | null;
  created: number;
};

export type ExportRunRow = {
  iteration: number;
  created: number;
  time: number;
  daily: number;
  void: number;
  ranked: number;
  pinned: number;
  client_id: string | null;
  data: string;
};

export type ExportNotificationRow = {
  iteration: number;
  kind: string;
  data: string;
  created: number;
  read_at: number | null;
};

export type ExportPushRow = {
  endpoint: string;
  created: number;
};

export type ExportFlagRow = {
  iteration: number;
  data: string;
};

export type ExportPbTopRow = {
  iteration: number;
  message_id: string | null;
  top_time: number | null;
  holders: number;
  announced_at: number | null;
};

// Every row held about one user, for "export my data" (GDPR access /
// portability), as six result sets in one round trip: the user row, all their
// runs (void included, since it is their data), notifications, push
// subscriptions, board flags, and the top-PB records announced under their id
// (pb_top). Timestamps are epoch millis so the caller ships numbers, not
// datetime strings. routes/exportData.ts shapes these into the export document:
// it deserializes the maze blob, parses the JSON columns and drops the push
// keys (crypto material, not personal data).
export const exportUserData = (userId: string) =>
  sql<[
    ExportUserRow[],
    ExportRunRow[],
    ExportNotificationRow[],
    ExportPushRow[],
    ExportFlagRow[],
    ExportPbTopRow[],
  ]>`
    SELECT id, name, rating, plays, settings, locale,
           UNIX_TIMESTAMP(created) * 1000 created
    FROM \`user\` WHERE id = ${userId};

    SELECT iteration, UNIX_TIMESTAMP(created) * 1000 created, time,
           daily, void, ranked, pinned, client_id, data
    FROM run WHERE user = ${userId} ORDER BY created ASC;

    SELECT iteration, kind, data,
           UNIX_TIMESTAMP(created) * 1000 created,
           UNIX_TIMESTAMP(read_at) * 1000 read_at
    FROM notification WHERE user = ${userId} ORDER BY created ASC;

    SELECT endpoint, UNIX_TIMESTAMP(created) * 1000 created
    FROM push_subscription WHERE user = ${userId};

    SELECT iteration, data FROM flag WHERE user = ${userId} ORDER BY iteration ASC;

    SELECT iteration, message_id, top_time, holders,
           UNIX_TIMESTAMP(announced_at) * 1000 announced_at
    FROM pb_top WHERE top_user = ${userId} ORDER BY iteration ASC;
  `;
