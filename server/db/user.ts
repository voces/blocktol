import { deserializeRun } from "../util/run.ts";
import { format, raw, sql } from "./query.ts";

type User = {
  id: string;
  name: string;
  rating: number;
};

export const getUser = (id: string) =>
  sql<(User | undefined)[]>`
    SELECT id, name, rating FROM user WHERE id = ${id};
  `.then((r) => r[0]);

export const createUser = (id: string, name: string) =>
  sql`
    INSERT INTO user (id, name) VALUES (${id}, ${name});
    SELECT id, name, rating FROM user WHERE id = ${id};
  `.then(() => getUser(id)!);

const createOrUpdateUserWithName = (id: string, name: string) =>
  sql<[unknown, User[]]>`
    INSERT INTO user (id, name) VALUES (${id}, ${name}) ON DUPLICATE KEY UPDATE name = ${name};
    SELECT id, name, rating FROM user WHERE id = ${id};
  `.then((r) => r[1][0]);

export const createOrUpdateUser = (id: string, name?: string) =>
  name === undefined
    ? sql<[unknown, User[]]>`
    INSERT INTO user (id) VALUES (${id}) ON DUPLICATE KEY UPDATE id = id;
    SELECT id, name, rating FROM user WHERE id = ${id};
  `.then((r) => r[1][0])
    : createOrUpdateUserWithName(id, name);

export const getUserPlays = (id: string) =>
  sql<({ count: number } | undefined)[]>`
    SELECT COUNT(1) count FROM run WHERE user = ${id} AND daily = TRUE;
  `.then((r) => r[0]?.count ?? 0);

// Counts a user's first 3 runs for an iteration, including abandoned (void)
// runs — starting a daily and not finishing it still costs an attempt, matching
// `dailyAttempts` (the timezone-based view).
export const dailyAttemptsByIteration = (user: string, iteration: number) =>
  sql<{ time: number }[]>`
    SELECT time
    FROM run
    WHERE user = ${user}
      AND iteration = ${iteration}
    ORDER BY created ASC
    LIMIT 3;
  `.then((r) => r.map((r) => r.time));

export const dailyAttempts = (
  user: string,
  year: number,
  month: number,
  day: number,
) =>
  sql<{ time: number }[]>`
    SELECT time
    FROM run
    WHERE user = ${user}
      AND iteration = (
        SELECT id
        FROM iteration
        WHERE YEAR(created) = ${year}
          AND MONTH(created) = ${month}
          AND DAY(created) = ${day}
        LIMIT 1
      )
    ORDER BY created ASC
    LIMIT 3;
  `.then((r) => r.map((r) => r.time));

export const listDailies = (
  user: string,
  limit = 1_000_000,
  offset = 0,
) =>
  sql<
    {
      iteration: number;
      created: number;
      ownBest: number | null;
      ownDailyBest: number | null;
      otherBest: number | null;
      best: number | null;
      min: number;
    }[]
  >`
  SELECT
    id iteration,
    iteration.created created,
    ROUND(MAX(CASE WHEN user = ${user} THEN time ELSE null END), 2) ownBest,
    ROUND(MAX(CASE WHEN user = ${user} AND daily = TRUE THEN time ELSE null END), 2) ownDailyBest,
    ROUND(MAX(CASE WHEN user != ${user} THEN time ELSE null END), 2) otherBest,
    MAX(time) best,
    min
  FROM iteration
  LEFT JOIN run ON iteration.id = run.iteration
  WHERE id <= (
    SELECT MAX(iteration) max
    FROM run
    WHERE user = ${user}
  )
  GROUP BY 1
  ORDER BY id DESC
  LIMIT ${limit} OFFSET ${offset};`.then((d) =>
    d.map((
      r,
    ): {
      iteration: number;
      daily: [number, number, number];
      ownDailyBest: number | null;
      ownBest: number | null;
      best: number | null;
      min: number;
      supreme: boolean;
    } => ({
      iteration: r.iteration,
      daily: [
        new Date(r.created).getUTCFullYear(),
        new Date(r.created).getUTCMonth() + 1,
        new Date(r.created).getUTCDate(),
      ],
      ownDailyBest: r.ownDailyBest,
      ownBest: r.ownBest,
      best: r.best,
      min: r.min,
      supreme: typeof r.ownBest === "number"
        ? typeof r.otherBest === "number" ? r.ownBest > r.otherBest : true
        : false,
    }))
  );

export const getOwnBest = (user: string, iteration: number) =>
  sql<{ ownBest: number }[] | null>`
    SELECT max(time) ownBest
    FROM run
    WHERE user = ${user}
      AND iteration = ${iteration};`.then((r) => r?.[0].ownBest ?? null);

export const getOwnBestMaze = (user: string, iteration: number) =>
  sql<({ data: string | null } | null)[] | null>`
    SELECT data
    FROM run
    WHERE user = ${user}
      AND iteration = ${iteration}
      AND LENGTH(DATA) > 0
      AND time = (
        SELECT max(time)
        FROM run
        WHERE user = ${user}
        AND iteration = ${iteration}
      )
    LIMIT 1;`.then((r) => r?.[0]?.data ? deserializeRun(r[0].data) : null);

export const updateRating = (user: string, rating: number) =>
  sql`UPDATE user SET rating = ${rating} WHERE id = ${user};`;

// Each completer of an iteration's daily, with their best time and current
// rating/plays. Abandoners (no completed run) are excluded — they already lose
// an attempt; they aren't rated.
export const getRatingParticipants = (iteration: number) =>
  sql<{ user: string; time: number; rating: number; plays: number }[]>`
    SELECT r.user, MAX(r.time) time,
           COALESCE(u.rating, 1000) rating, COALESCE(u.plays, 0) plays
    FROM run r
    JOIN user u ON u.id = r.user
    WHERE r.iteration = ${iteration}
      AND r.daily = TRUE
      AND r.void = FALSE
    GROUP BY r.user, u.rating, u.plays;
  `;

// Apply a batch of rating updates and mark the iteration rated, in one
// transaction so a partial failure can't double- or under-count. The updates
// are a single bulk upsert (one statement, one parse) rather than one UPDATE
// per player, so it scales to thousands of participants.
export const applyRatings = (
  iteration: number,
  updates: { user: string; rating: number; plays: number }[],
) => {
  const upsert = updates.length === 0 ? "" : format`
    INSERT INTO user (id, rating, plays)
    VALUES ${updates.map((u) => [u.user, u.rating, u.plays])}
    ON DUPLICATE KEY UPDATE rating = VALUES(rating), plays = VALUES(plays);
  `;
  return sql`
    START TRANSACTION;
    ${raw(upsert)}
    UPDATE iteration SET rated = TRUE WHERE id = ${iteration};
    COMMIT;
  `;
};
