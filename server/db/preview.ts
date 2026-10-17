import { sql } from "./query.ts";

// What the board gate (util/boardAccess.ts) needs to know about the caller on
// one iteration, in one round trip: how many ranked attempts they have opened
// on it (void ones included — abandoning still spends an attempt), and whether
// they have already been shown it as a preview.
export const boardAccessState = (user: string, iteration: number) =>
  sql<{ ranked: number; previewed: number }[]>`
    SELECT
      (SELECT COUNT(1) FROM run
        WHERE user = ${user} AND iteration = ${iteration} AND ranked = TRUE
      ) ranked,
      EXISTS(
        SELECT 1 FROM preview WHERE user = ${user} AND iteration = ${iteration}
      ) previewed;
  `.then((r) => ({
    rankedAttempts: Number(r[0]?.ranked ?? 0),
    previewed: !!Number(r[0]?.previewed ?? 0),
  }));

// Record that the caller was shown a board they could still rank by claiming a
// western timezone (see util/boardAccess.ts); startRun then refuses them a
// ranked attempt on it. INSERT IGNORE on the (user, iteration) key, so a repeat
// is a no-op — idempotent, hence `sql`'s retry is safe.
export const recordPreview = (user: string, iteration: number) =>
  sql`
    INSERT IGNORE INTO preview (user, iteration)
    VALUES (${user}, ${iteration});
  `;
