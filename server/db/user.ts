import { ListMessage } from "../../common/serverToClientMessage.ts";
import { getDailyIterationId } from "./iteration.ts";
import { sql } from "./query.ts";

type User = {
  id: string;
  name: string;
  rating: number;
};

const getUser = (id: string) =>
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

export const dailyAttemptsByIteration = (user: string, iteration: number) =>
  sql<{ time: number }[]>`
    SELECT time
    FROM run
    WHERE user = ${user}
      AND iteration = ${iteration}
      AND void = FALSE
    ORDER BY created ASC
    LIMIT 3;
  `.then((r) => r.map((r) => r.time));

export const dailyAttempts = async (
  user: string,
  year: number,
  month: number,
  day: number,
) =>
  dailyAttemptsByIteration(user, await getDailyIterationId(year, month, day));

export const listDailies = (
  user: string,
) =>
  sql<
    {
      iteration: number;
      created: number;
      ownBest: number | null;
      ownDailyBest: number | null;
      best: number | null;
      min: number;
    }[]
  >`
  SELECT
    id iteration,
    iteration.created created,
    ROUND(MAX(CASE WHEN user = ${user} THEN time ELSE null END), 2) ownBest,
    ROUND(MAX(CASE WHEN user = ${user} AND daily = TRUE THEN time ELSE null END), 2) ownDailyBest,
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
  ORDER BY id DESC;`.then((d) =>
    d.map((r): ListMessage["items"][number] => ({
      iteration: r.iteration,
      daily: [
        new Date(r.created).getUTCFullYear(),
        new Date(r.created).getUTCMonth() + 1,
        new Date(r.created).getUTCDate(),
      ],
      ownDailyBest: r.ownDailyBest,
      ownBest: r.ownBest,
      best: r.best,
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
    LIMIT 1;`.then((r) => r?.[0]?.data ?? null);

export const markDaily = (user: string, iteration: number) =>
  sql`
    UPDATE run
    SET daily = TRUE
    WHERE user = ${user} AND iteration = ${iteration} AND void = FALSE
    ORDER BY time DESC
    LIMIT 1;
  `;

export const updateRating = (user: string, rating: number) =>
  sql`UPDATE user SET rating = ${rating} WHERE id = ${user};`;
