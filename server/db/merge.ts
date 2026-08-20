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
// The one correction is the daily flag. A day both devices played would leave two
// runs flagged as that day's counted result, and stats/calendar expect one. We
// keep the EARLIEST attempt and demote the other — merging can't swap a day's
// result for a faster run from the other account (an upgrade you didn't earn on
// the day). And it ONLY ever clears a flag, never sets one: a daily is legitimate
// only on the user's own local day, decided at creation, so the pool of dailies
// is fixed to runs already marked and a merge must never mint one from free play.
// A run is demoted iff an earlier-created daily sibling exists on the same
// iteration (higher time breaks an exact-timestamp tie), so exactly the single
// earliest daily survives.
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

    DELETE FROM user WHERE id = ${secondary};

    COMMIT;
  `;
