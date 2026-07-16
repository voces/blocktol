import { sql } from "./query.ts";

// The Discord "top PB" dedup marker: who currently holds the announced top of an
// iteration's PB (best-build) board — one row per iteration (see util/pbBoard.ts).
// The post fires only when a build makes a NEW holder the top, so this marker is
// what tells a lead change apart from a burst of the same holder's leading saves
// (or a replay), with no message id / edit state at all.
export const getPbTop = (iteration: number): Promise<string | null> =>
  sql<{ top_user: string }[]>`
    SELECT top_user FROM pb_top WHERE iteration = ${iteration};
  `.then((r) => r[0]?.top_user ?? null);

// Idempotent absolute-value write keyed by iteration → `sql` (retry-once) is safe.
export const upsertPbTop = (iteration: number, topUser: string) =>
  sql`
    INSERT INTO pb_top (iteration, top_user)
    VALUES (${iteration}, ${topUser})
    ON DUPLICATE KEY UPDATE top_user = VALUES(top_user);
  `;
