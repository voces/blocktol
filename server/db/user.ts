import { sql } from "./query.ts";

type User = {
  id: string;
  rating: number;
  plays: number;
};

export const getUser = (id: string) =>
  sql<(User | undefined)[]>`
    SELECT id, rating, plays
    FROM user
    WHERE id = ${id};
    `.then((u) => u[0]);

export const createUser = (id: string, name: string) =>
  sql`
    INSERT INTO user (id, name)
    VALUES (${id}, ${name});
    `.then(() => getUser(id));

export const createOrGetUser = (id: string, name: string) => sql;
