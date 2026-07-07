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
// runs flagged as that day's counted result (each device kept its own best), and
// stats/calendar expect one. We keep the better and demote the other — but ONLY
// ever clear a flag, never set one: a daily is legitimate only on the user's own
// local day, decided at creation, so the pool of dailies is fixed to runs already
// marked and a merge must never mint a new one from free play. A run is demoted
// iff a strictly better daily sibling exists on the same iteration (higher time,
// or equal time created earlier), so exactly the single best daily survives.
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
      AND (o.time > r.time OR (o.time = r.time AND o.created < r.created))
    SET r.daily = FALSE
    WHERE r.user = ${primary} AND r.daily = TRUE;

    DELETE FROM user WHERE id = ${secondary};

    COMMIT;
  `;
