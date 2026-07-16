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
  announcedAt: number; // ms epoch — when this standing post was (re)posted
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
      announced_at: number;
    }[]
  >`
    SELECT
      message_id, top_time, top_user, holders,
      UNIX_TIMESTAMP(announced_at) * 1000 announced_at
    FROM pb_announcement
    WHERE iteration = ${iteration};
  `.then((r) =>
    r[0]
      ? {
        messageId: r[0].message_id,
        topTime: Number(r[0].top_time),
        topUser: r[0].top_user,
        holders: Number(r[0].holders),
        announcedAt: Number(r[0].announced_at),
      }
      : null
  );

// Record a freshly POSTED record message, stamping `announced_at` to now — the
// anchor for the same-holder edit window (see util/pbBoard.ts). Overwrites any
// prior row for the iteration (a lead change or a post-window re-post). Idempotent
// absolute-value write keyed by iteration, so `sql` (retry-once) is correct.
export const upsertPbAnnouncement = (
  iteration: number,
  messageId: string,
  topTime: number,
  topUser: string,
  holders: number,
) =>
  sql`
    INSERT INTO pb_announcement (iteration, message_id, top_time, top_user, holders, announced_at)
    VALUES (${iteration}, ${messageId}, ${topTime}, ${topUser}, ${holders}, current_timestamp())
    ON DUPLICATE KEY UPDATE
      message_id = VALUES(message_id),
      top_time = VALUES(top_time),
      top_user = VALUES(top_user),
      holders = VALUES(holders),
      announced_at = current_timestamp();
  `;

// Update an EDITED record message's top state in place, deliberately leaving
// `announced_at` (and `message_id`) untouched — an edit doesn't move the window
// anchor, so a burst of edits can't push the same-holder re-post threshold out.
export const editPbAnnouncement = (
  iteration: number,
  topTime: number,
  topUser: string,
  holders: number,
) =>
  sql`
    UPDATE pb_announcement
    SET top_time = ${topTime}, top_user = ${topUser}, holders = ${holders}
    WHERE iteration = ${iteration};
  `;
