import { sql } from "./query.ts";

// The Discord "top PB" marker: the currently-announced top of an iteration's PB
// (best-build) board — one row per iteration (see util/pbBoard.ts). It records who
// holds it (`top_user`), the announced time and message so a same-holder
// improvement (or a match) can PATCH that same message, how many players share the
// announced top (`holders`, so a match edits the tie count and the holder later
// breaking it re-posts), and when the post went up (`announced_at`, the window
// anchor — set on a post, left as-is by an edit). `message_id`/`top_time`/
// `announced_at` are nullable for rows written before those columns existed (a null
// message falls back to a fresh post); `holders` defaults to 1.
export type PbTop = {
  messageId: string | null;
  topUser: string;
  topTime: number | null;
  holders: number;
  announcedAt: number | null; // ms epoch
};

export const getPbTop = (iteration: number): Promise<PbTop | null> =>
  sql<
    {
      message_id: string | null;
      top_user: string;
      top_time: number | null;
      holders: number;
      announced_at: number | null;
    }[]
  >`
    SELECT
      message_id, top_user, top_time, holders,
      UNIX_TIMESTAMP(announced_at) * 1000 announced_at
    FROM pb_top WHERE iteration = ${iteration};
  `.then((r) =>
    r[0]
      ? {
        messageId: r[0].message_id,
        topUser: r[0].top_user,
        topTime: r[0].top_time == null ? null : Number(r[0].top_time),
        holders: Number(r[0].holders),
        announcedAt: r[0].announced_at == null
          ? null
          : Number(r[0].announced_at),
      }
      : null
  );

// Record a freshly POSTED message, stamping `announced_at` to now (the anchor for
// the same-holder edit window). Overwrites any prior row for the iteration (a lead
// change, or a post past the window / past a match). Idempotent absolute-value
// write keyed by iteration → `sql` (retry-once) is safe.
export const upsertPbTop = (
  iteration: number,
  messageId: string,
  topUser: string,
  topTime: number,
  holders: number,
) =>
  sql`
    INSERT INTO pb_top (iteration, message_id, top_user, top_time, holders, announced_at)
    VALUES (${iteration}, ${messageId}, ${topUser}, ${topTime}, ${holders}, current_timestamp())
    ON DUPLICATE KEY UPDATE
      message_id = VALUES(message_id),
      top_user = VALUES(top_user),
      top_time = VALUES(top_time),
      holders = VALUES(holders),
      announced_at = current_timestamp();
  `;

// Advance the announced time / tie count after an EDIT (a same-holder improvement
// within the window, or a new match), leaving `message_id`/`top_user`/
// `announced_at` (the window anchor) untouched so a burst of edits can't defer the
// past-window re-post.
export const editPbTop = (
  iteration: number,
  topTime: number,
  holders: number,
) =>
  sql`
    UPDATE pb_top
    SET top_time = ${topTime}, holders = ${holders}
    WHERE iteration = ${iteration};
  `;
