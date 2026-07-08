import { sql } from "./query.ts";

// One row per player on an iteration's daily board: their best ranked-daily
// time (the same daily = TRUE, void = FALSE field ratings and percentiles
// use — free play stays off the board), when that best was FIRST set (ties
// within a player's own runs resolve to the earliest, matching mapAttempts'
// "first run at the best time"), and their display name. Ordered best-first
// (time DESC, then earliest-at first), so the array index IS the standing
// order buildStandings expects.
//
// The inner GROUP BY walks iteration_daily_void_time_idx; the join back for
// the best run's timestamp touches only each player's few daily rows.
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

// Everyone with a non-void run on this iteration, with their best build that
// day — ranked attempts AND free play, unlike getDailyStandings' ranked-only
// field. This is the standings "PB" sort's population (best maze built on that
// day's board, however), and it also supplies the daily board's "PB" secondary
// per player. A day the viewer only free-played still has rows here even when
// the ranked daily field is empty. Names come along for the players who never
// appear in the ranked field.
export const getIterationBests = (iteration: number) =>
  sql<{ user: string; name: string | null; best: number }[]>`
    SELECT r.user user, u.name name, MAX(r.time) best
    FROM run r
    JOIN user u ON u.id = r.user
    WHERE r.iteration = ${iteration} AND r.void = FALSE
    GROUP BY r.user, u.name;
  `;

// The iteration facts the standings header needs: whether the field is frozen
// (rated), its calendar day, and the day's start — from which the "until
// ranked" close is derived. DATE()/YEAR()-style reads keep the day identical
// to how getDailyIterationId resolves it.
export const getStandingsMeta = (iteration: number) =>
  sql<
    {
      rated: number;
      dayStart: number;
      y: number;
      m: number;
      d: number;
    }[]
  >`
    SELECT
      rated,
      UNIX_TIMESTAMP(DATE(created)) * 1000 dayStart,
      YEAR(created) y, MONTH(created) m, DAY(created) d
    FROM iteration
    WHERE id = ${iteration};
  `.then((r) => {
    if (!r[0]) throw new Error(`Iteration ${iteration} does not exist`);
    return r[0];
  });
