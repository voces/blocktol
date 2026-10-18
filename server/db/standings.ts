import { NotFoundError } from "../util/UserError.ts";
import { sql } from "./query.ts";

// One row per player on an iteration's daily board: their best ranked-daily
// time (the daily = TRUE, void = FALSE field ratings and percentiles use; free
// play stays off), when that best was FIRST set (ties within a player's own
// runs resolve to the earliest, as in mapAttempts), and their name. Ordered
// best-first (time DESC, then earliest `at`), so the array index IS the
// standing order buildStandings expects.
//
// The inner GROUP BY walks iteration_daily_void_time_idx; the join back for the
// timestamp touches only each player's few daily rows.
export const getDailyStandings = (iteration: number) =>
  sql<{ user: string; name: string | null; time: number; at: number }[]>`
    SELECT
      best.user user,
      u.name name,
      best.t time,
      UNIX_TIMESTAMP(MIN(r.created)) * 1000 at
    FROM (
      SELECT user, MAX(time) t
      FROM run
      WHERE iteration = ${iteration} AND daily = TRUE AND void = FALSE
      GROUP BY user
    ) best
    JOIN run r
      ON r.user = best.user
      AND r.iteration = ${iteration}
      AND r.daily = TRUE
      AND r.void = FALSE
      AND r.time = best.t
    JOIN user u ON u.id = best.user
    GROUP BY best.user, best.t, u.name
    ORDER BY best.t DESC, at ASC;
  `;

// Everyone with a non-void run on this iteration, with their best build and
// WHEN it was first set: ranked AND free play, unlike getDailyStandings. This
// is the standings "PB" sort's population and supplies the daily board's "PB"
// secondary per player. A day only free-played still has rows when the ranked
// field is empty. `at` (earliest run at the best time, as in getDailyStandings)
// is the PB row's "2h ago" sub-line.
export const getIterationBests = (iteration: number) =>
  sql<{ user: string; name: string | null; best: number; at: number }[]>`
    SELECT
      best.user user,
      u.name name,
      best.t best,
      UNIX_TIMESTAMP(MIN(r.created)) * 1000 at
    FROM (
      SELECT user, MAX(time) t
      FROM run
      WHERE iteration = ${iteration} AND void = FALSE
      GROUP BY user
    ) best
    JOIN run r
      ON r.user = best.user
      AND r.iteration = ${iteration}
      AND r.void = FALSE
      AND r.time = best.t
    JOIN user u ON u.id = best.user
    GROUP BY best.user, best.t, u.name;
  `;

// The day's field for the daily-outcome classifier (common/notifications.ts):
// one row per player with a non-void run, with their best RANKED daily time
// (`daily`, null if they only free-played) and best build (`pb`, free play
// included). The rating cron reads it when a day closes. Same population as
// getIterationBests; the LEFT JOIN attaches the ranked time.
export const getIterationOutcomeField = (iteration: number) =>
  sql<{ user: string; daily: number | null; pb: number }[]>`
    SELECT
      bests.user user,
      ROUND(bests.t, 2) pb,
      ROUND(ranked.t, 2) daily
    FROM (
      SELECT user, MAX(time) t
      FROM run
      WHERE iteration = ${iteration} AND void = FALSE
      GROUP BY user
    ) bests
    LEFT JOIN (
      SELECT user, MAX(time) t
      FROM run
      WHERE iteration = ${iteration} AND daily = TRUE AND void = FALSE
      GROUP BY user
    ) ranked ON ranked.user = bests.user;
  `.then((r) =>
    r.map((row) => ({
      user: row.user,
      pb: Number(row.pb),
      daily: row.daily == null ? null : Number(row.daily),
    }))
  );

// The iteration facts the standings header needs: whether the field is frozen
// (rated), its calendar day, the day's start (the "until ranked" close derives
// from it), and the par floor `min` (the [min, best] range standing is
// measured in). DATE()/YEAR()-style reads match getDailyIterationId's day.
export const getStandingsMeta = (iteration: number) =>
  sql<
    {
      rated: number;
      dayStart: number;
      y: number;
      m: number;
      d: number;
      min: number | null;
    }[]
  >`
    SELECT
      rated,
      UNIX_TIMESTAMP(DATE(created)) * 1000 dayStart,
      YEAR(created) y, MONTH(created) m, DAY(created) d,
      min
    FROM iteration
    WHERE id = ${iteration};
  `.then((r) => {
    // A client-supplied id: a 404, not a 500 + error log.
    if (!r[0]) throw new NotFoundError(`Iteration ${iteration} does not exist`);
    return r[0];
  });
