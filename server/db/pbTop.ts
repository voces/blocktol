import { sql } from "./query.ts";

// The Discord "top PB" marker: the currently-announced top of an iteration's PB
// (best-build) board — one row per iteration (see util/pbBoard.ts). It records who
// holds it (`top_user`, the dedup key that tells a lead change apart from a burst
// of the same holder's leading saves or a replay), the announced time and message
// so a same-holder improvement can PATCH that same message within the edit window,
// and when the post went up (`announced_at`, the window anchor — set on a post,
// left untouched by an edit). `message_id`/`top_time`/`announced_at` are nullable
// for rows written before the edit window existed (migration v12); a null message
// simply falls back to posting a fresh message.
export type PbTop = {
  messageId: string | null;
  topUser: string;
  topTime: number | null;
  announcedAt: number | null; // ms epoch
};

export const getPbTop = (iteration: number): Promise<PbTop | null> =>
  sql<
    {
      message_id: string | null;
      top_user: string;
      top_time: number | null;
      announced_at: number | null;
    }[]
  >`
    SELECT
      message_id, top_user, top_time,
      UNIX_TIMESTAMP(announced_at) * 1000 announced_at
    FROM pb_top WHERE iteration = ${iteration};
  `.then((r) =>
    r[0]
      ? {
        messageId: r[0].message_id,
        topUser: r[0].top_user,
        topTime: r[0].top_time == null ? null : Number(r[0].top_time),
        announcedAt: r[0].announced_at == null
          ? null
          : Number(r[0].announced_at),
      }
      : null
  );

// Record a freshly POSTED message, stamping `announced_at` to now (the anchor for
// the same-holder edit window). Overwrites any prior row for the iteration (a lead
// change, or a post past the window). Idempotent absolute-value write keyed by
// iteration → `sql` (retry-once) is safe.
export const upsertPbTop = (
  iteration: number,
  messageId: string,
  topUser: string,
  topTime: number,
) =>
  sql`
    INSERT INTO pb_top (iteration, message_id, top_user, top_time, announced_at)
    VALUES (${iteration}, ${messageId}, ${topUser}, ${topTime}, current_timestamp())
    ON DUPLICATE KEY UPDATE
      message_id = VALUES(message_id),
      top_user = VALUES(top_user),
      top_time = VALUES(top_time),
      announced_at = current_timestamp();
  `;

// Advance only the announced time after an EDIT, leaving `message_id`/`top_user`/
// `announced_at` (the window anchor) untouched so a burst of edits can't defer the
// past-window re-post.
export const bumpPbTopTime = (iteration: number, topTime: number) =>
  sql`
    UPDATE pb_top SET top_time = ${topTime} WHERE iteration = ${iteration};
  `;
