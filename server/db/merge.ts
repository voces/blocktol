import { sql } from "./query.ts";

// A user's "data" for the move/merge decision: non-void runs (ranked daily
// attempts plus free play, excluding abandoned/voided). This is the figure the
// thresholds compare — a clean device is 0, and the silent-merge escape hatch
// fires when one side is under 5% of the other.
export const nonVoidRunCount = (user: string) =>
  sql<{ count: number }[]>`
    SELECT COUNT(1) count FROM run WHERE user = ${user} AND void = FALSE;
  `.then((r) => Number(r[0]?.count ?? 0));

// Fold `secondary` into `primary`: reassign all of the secondary's runs, then
// delete the secondary user row. The primary keeps its identity wholesale — name,
// colour (derived from its id), rating, plays, settings — because we never touch
// its row; the mock's "the primary sets what you keep" falls out of leaving the
// primary row untouched and only moving runs onto it. Nothing is recomputed.
//
// The one correction is ranked-ness. A day both devices RANKED would leave the
// merged player with up to six ranked attempts on it, and the counted result
// (`daily`) is re-pointed at the best ranked run on every save (updateCurrentRun)
// — so a merge would turn three-and-three into best-of-six, or let a player rank
// on a spare id and fold it in only when it went well. So on every iteration
// where the PRIMARY already has a ranked attempt (void included — an abandoned
// attempt is still spent), the secondary's runs there are demoted to plain
// history (ranked = FALSE, daily = FALSE) before they move: the primary's three
// stand, as "the primary sets what you keep" says, and the secondary's builds
// survive as free-play-like rows. A day only the secondary ranked moves over
// whole — it's still one player's three attempts. Demotion only ever clears
// flags, never sets one: a ranked attempt is legitimate only on the user's own
// local day, decided at creation, and a merge must never mint one.
//
// The earliest-daily pass after the move is the older guard for the same
// invariant (one counted result per day). With the demotion above it can no
// longer find two dailies on an iteration, but it's kept as the backstop: a run
// is demoted iff an earlier-created daily sibling exists on the same iteration
// (higher time breaks an exact-timestamp tie), so exactly one daily survives.
//
// The Discord top-PB marker (`pb_top.top_user`, no FK) names the secondary when
// it holds a day's announced record; it's rewritten to the primary, which now
// owns the record runs. Left alone it would point at a deleted id, and the next
// build by the (merged) holder would read as a lead CHANGE (a fresh post) rather
// than the same holder improving (an edit).
//
// Splits flags come across too, but only for boards the primary has none of
// (INSERT IGNORE on the (user, iteration) key): the primary keeps its own marks
// wherever the two devices flagged the same day, matching "the primary sets what
// you keep". Whatever isn't carried over goes with the secondary's row.
//
// All of it is one round trip wrapped in a transaction. A single query runs on
// one connection (the same guarantee startRun's session variables rely on), so
// the reassign, demote, and delete commit together or not at all.
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

    INSERT IGNORE INTO flag (user, iteration, data)
      SELECT ${primary}, iteration, data FROM flag WHERE user = ${secondary};

    UPDATE pb_top SET top_user = ${primary} WHERE top_user = ${secondary};

    DELETE FROM user WHERE id = ${secondary};

    COMMIT;
  `;
