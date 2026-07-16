import { sql } from "./query.ts";

// The Discord "top PB" post's state, one row per iteration (see util/pbBoard.ts).
// It records the message we posted for the day's current record so a later build
// can decide whether to post a NEW record (a strictly higher top) or EDIT this
// one (players newly matching the same top): `message_id` is what we PATCH, and
// (`top_time`, `holders`) is the state we diff against to avoid a redundant edit
// when nothing about the top changed. `top_time` is DECIMAL so it reads back as
// the exact two-decimal value the game stores (float MAX would drift and break
// the equality test for a tie).
export type PbAnnouncement = {
  messageId: string;
  topTime: number;
  topUser: string;
  holders: number;
};

export const getPbAnnouncement = (
  iteration: number,
): Promise<PbAnnouncement | null> =>
  sql<
    {
      message_id: string;
      top_time: number;
      top_user: string;
      holders: number;
    }[]
  >`
    SELECT message_id, top_time, top_user, holders
    FROM pb_announcement
    WHERE iteration = ${iteration};
  `.then((r) =>
    r[0]
      ? {
        messageId: r[0].message_id,
        topTime: Number(r[0].top_time),
        topUser: r[0].top_user,
        holders: Number(r[0].holders),
      }
      : null
  );

// Upsert the day's record post state. Idempotent (absolute-value write keyed by
// iteration), so `sql` (retry-once) is correct — a retried write can't duplicate.
export const upsertPbAnnouncement = (
  iteration: number,
  messageId: string,
  topTime: number,
  topUser: string,
  holders: number,
) =>
  sql`
    INSERT INTO pb_announcement (iteration, message_id, top_time, top_user, holders)
    VALUES (${iteration}, ${messageId}, ${topTime}, ${topUser}, ${holders})
    ON DUPLICATE KEY UPDATE
      message_id = VALUES(message_id),
      top_time = VALUES(top_time),
      top_user = VALUES(top_user),
      holders = VALUES(holders);
  `;
