import { sql } from "./query.ts";

// A user's "data" for the move/merge decision: non-void runs (ranked daily
// attempts plus free play, excluding abandoned/voided). This is the figure the
// thresholds compare — a clean device is 0, and the silent-merge escape hatch
// fires when one side is under 5% of the other.
export const nonVoidRunCount = (user: string) =>
  sql<{ count: number }[]>`
    SELECT COUNT(1) count FROM run WHERE user = ${user} AND void = FALSE;
  `.then((r) => Number(r[0]?.count ?? 0));

// Re-establish the daily flag for one (user, iteration) exactly as
// updateCurrentRun does on a native run: within the iteration's own day, demote
// every run, then promote the best-timed of the first three (earliest by created
// on a tie). Only the day's single best-of-three carries daily = TRUE — the
// figure calendar/stats/percentile read. Runs beyond the first three are ranked
// only positionally at read time, so they need no write here.
const renormalizeDaily = (user: string, iteration: number) =>
  sql`
    UPDATE run
    SET daily = FALSE
    WHERE user = ${user}
      AND iteration = ${iteration}
      AND YEAR(created) = (SELECT YEAR(created) FROM iteration WHERE id = ${iteration})
      AND MONTH(created) = (SELECT MONTH(created) FROM iteration WHERE id = ${iteration})
      AND DAY(created) = (SELECT DAY(created) FROM iteration WHERE id = ${iteration});

    UPDATE run
    SET daily = TRUE
    WHERE user = ${user}
      AND iteration = ${iteration}
      AND time = (
        SELECT MAX(time)
        FROM (
          SELECT time
          FROM run
          WHERE user = ${user}
            AND iteration = ${iteration}
            AND YEAR(created) = (SELECT YEAR(created) FROM iteration WHERE id = ${iteration})
            AND MONTH(created) = (SELECT MONTH(created) FROM iteration WHERE id = ${iteration})
            AND DAY(created) = (SELECT DAY(created) FROM iteration WHERE id = ${iteration})
          ORDER BY created ASC LIMIT 3
        ) t1
      )
      AND YEAR(created) = (SELECT YEAR(created) FROM iteration WHERE id = ${iteration})
      AND MONTH(created) = (SELECT MONTH(created) FROM iteration WHERE id = ${iteration})
      AND DAY(created) = (SELECT DAY(created) FROM iteration WHERE id = ${iteration})
    ORDER BY created ASC LIMIT 1;
  `;

// Fold `secondary` into `primary`: reassign all of the secondary's runs, then
// delete the secondary user row. The primary keeps its identity wholesale — name,
// colour (derived from its id), rating, plays, settings — because we never touch
// its row; the mock's "the primary sets what you keep" falls out of leaving the
// primary row untouched and only moving runs onto it. Nothing is recomputed.
//
// The one correction: a day both devices played would otherwise leave two runs
// flagged as that day's counted result. `overlap` finds exactly those days, and
// each is renormalized so the merged rows match what a single device would have
// produced. Overlap is only same-day-on-both-devices, so it's a handful of days
// even when both sides are large.
export const mergeUsers = async (primary: string, secondary: string) => {
  const overlap = await sql<{ iteration: number }[]>`
    SELECT DISTINCT s.iteration iteration
    FROM run s
    JOIN run p
      ON p.iteration = s.iteration AND p.user = ${primary}
    JOIN iteration it
      ON it.id = s.iteration
    WHERE s.user = ${secondary}
      AND DATE(s.created) = DATE(it.created)
      AND DATE(p.created) = DATE(it.created);
  `;

  await sql`
    UPDATE run SET user = ${primary} WHERE user = ${secondary};
  `;

  for (const { iteration } of overlap) {
    await renormalizeDaily(primary, iteration);
  }

  await sql`
    DELETE FROM user WHERE id = ${secondary};
  `;

  return { movedFrom: secondary, into: primary, renormalized: overlap.length };
};
