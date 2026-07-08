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

// Each listed player's best build (any daily or free), `void = FALSE`, ON OR
// BEFORE the given iteration — their PB "as of that day". Iteration ids are
// monotonic per day, so `iteration <= upto` bounds it to that day and earlier:
// on today's board it's the current all-time PB (same figure as the profile's
// bestBuild); on a past day's board it's the PB as it stood then, so a later
// improvement doesn't leak backwards. The standings PB sort re-ranks the day's
// players by this, and the daily board shows it as each row's "PB" secondary.
// Restricted to the day's players (an `IN (...)` over user_void_time_idx, so
// each user's MAX is an index range) rather than the whole user base. Empty in
// → no query.
export const getPbForUsers = (users: readonly string[], upto: number) =>
  users.length === 0 ? Promise.resolve(new Map<string, number>()) : sql<
    { user: string; pb: number }[]
  >`
    SELECT user, MAX(time) pb
    FROM run
    WHERE void = FALSE AND iteration <= ${upto} AND user IN (${users})
    GROUP BY user;
  `.then((r) => new Map(r.map((x) => [x.user, x.pb])));

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
