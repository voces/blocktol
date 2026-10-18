import { z } from "zod";
import { nonVoidRunCount } from "../db/merge.ts";
import { sql } from "../db/query.ts";
import { method } from "./apiHelpers.ts";

// Summarize one or two profiles by id: name, join date, rating and `runs`
// (non-void count). Drives the move/merge gate when a sign-in link opens on a
// device that already has a profile: the client looks up both ids to choose
// between a silent merge, the fork, or a clean adopt. `runs` is what the
// confirm screens show and the silent-merge threshold compares.
//
// Unauthed by design: a clean device opening a link has no id yet, and holding
// an id already grants full sign-in as that user (see client/util/id.ts), so
// the lookup exposes nothing new. Results are in input order, null for unknown
// ids.
const moveInfoBody = z.object({
  ids: z.array(z.string().trim().min(1).max(36)).min(1).max(2),
});

const side = async (id: string) => {
  const [row] = await sql<
    { name: string | null; joined: number; rating: number }[]
  >`
    SELECT name, rating, UNIX_TIMESTAMP(created) * 1000 joined
    FROM user WHERE id = ${id};
  `;
  if (!row) return null;
  return {
    id,
    name: row.name,
    joined: Number(row.joined),
    rating: Math.round(Number(row.rating)),
    runs: await nonVoidRunCount(id),
  };
};

export const moveInfo = method(moveInfoBody)(
  ({ ids }) => Promise.all(ids.map(side)),
);
