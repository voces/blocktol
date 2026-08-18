import { sql } from "./query.ts";

// Every row we hold that belongs to one user, for their "export my data" (GDPR
// access / portability). Five result sets in one round trip: the user row, all
// their runs (void included — it's their data, even abandoned attempts), their
// notification history, their push subscriptions, and their board flags.
// Timestamps come back as epoch millis (UNIX_TIMESTAMP * 1000) so the caller
// ships plain numbers rather than the proxy's datetime strings. The route shapes these into the export
// document (see routes/exportData.ts) — deserializing the maze blob, parsing the
// JSON columns, and dropping the push encryption keys (crypto material, not
// meaningful personal data).
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

export const exportUserData = (userId: string) =>
  sql<[
    ExportUserRow[],
    ExportRunRow[],
    ExportNotificationRow[],
    ExportPushRow[],
    ExportFlagRow[],
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
  `;
