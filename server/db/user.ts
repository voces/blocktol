import { getDailyIterationId } from "./iteration.ts";
import { sql } from "./query.ts";

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

export const createOrUpdateUserWithName = (id: string, name: string) =>
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
    SELECT COUNT(*) count FROM run WHERE user = ${id};
  `.then((r) => r[0]?.count ?? 0);

export const dailyAttempts = async (
  user: string,
  year: number,
  month: number,
  day: number,
) =>
  sql<{ time: number }[]>`
    SELECT time
    FROM run
    WHERE user = ${user}
      AND iteration = ${await getDailyIterationId(year, month, day)}
    ORDER BY created ASC
    LIMIT 3;
  `.then((r) => r.map((r) => r.time));
