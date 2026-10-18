import { sql } from "./query.ts";

// A user's "data" for the move/merge decision: non-void runs (ranked attempts
// plus free play). The thresholds compare it: a clean device is 0, and the
// silent-merge escape hatch fires when one side is under 5% of the other.
export const nonVoidRunCount = (user: string) =>
  sql<{ count: number }[]>`
    SELECT COUNT(1) count FROM run WHERE user = ${user} AND void = FALSE;
  `.then((r) => Number(r[0]?.count ?? 0));

// Folds `secondary` into `primary`: reassigns the secondary's runs, then
// deletes the secondary user row. The primary's row is never touched, so it
// keeps its name, colour (derived from its id), rating, plays and settings.
// Nothing is recomputed.
//
// The one correction is ranked-ness. A day both devices RANKED would leave up
// to six ranked attempts, and `daily` is re-pointed at the best ranked run on
// every save (updateCurrentRun), so the merge would turn three-and-three into
// best-of-six. So on every iteration where the PRIMARY already has a ranked
// attempt (void included: an abandoned attempt is spent), the secondary's runs
// are demoted to plain history (ranked = FALSE, daily = FALSE) before they
// move. A day only the secondary ranked moves over whole. Demotion only clears
// flags: a ranked attempt is legitimate only on the user's own local day,
// decided at creation, and a merge must never mint one.
//
// The earliest-daily pass after the move is a backstop for one counted result
// per day: a run is demoted iff an earlier-created daily sibling exists on the
// iteration (higher time breaks an exact-timestamp tie).
//
// `pb_top.top_user` has no FK, so a marker naming the secondary is rewritten to
// the primary, which now owns the record runs. Left alone it would name a
// deleted id, and the merged holder's next build would read as a lead CHANGE
// (a fresh post) instead of the same holder improving (an edit).
//
// One query runs on one connection, so the transaction commits the reassign,
// demote and delete together or not at all.
export const mergeUsers = (primary: string, secondary: string) =>
  sql`
    START TRANSACTION;

    UPDATE run s
    JOIN run p
      ON p.iteration = s.iteration
      AND p.user = ${primary}
      AND p.ranked = TRUE
    SET s.ranked = FALSE, s.daily = FALSE
    WHERE s.user = ${secondary} AND (s.ranked = TRUE OR s.daily = TRUE);

    UPDATE run SET user = ${primary} WHERE user = ${secondary};

    UPDATE run r
    JOIN run o
      ON o.user = r.user
      AND o.iteration = r.iteration
      AND o.daily = TRUE
      AND (o.created < r.created OR (o.created = r.created AND o.time > r.time))
    SET r.daily = FALSE
    WHERE r.user = ${primary} AND r.daily = TRUE;

    UPDATE pb_top SET top_user = ${primary} WHERE top_user = ${secondary};

    DELETE FROM user WHERE id = ${secondary};

    COMMIT;
  `;
