import { z } from "zod";
import { nonVoidRunCount } from "../db/merge.ts";
import { sql } from "../db/query.ts";
import { method } from "./apiHelpers.ts";

// Summarize one or two profiles by id — display name, join date, and data size
// (non-void run count). Drives the move/merge gate when a sign-in link opens on a
// device that already has a profile: the client looks up its own id and the
// link's id to decide between a silent merge, the fork, or a clean adopt. `runs`
// is the figure the fork/confirm screens show and the number the silent-merge
// threshold compares.
//
// Unauthed by design: a clean device opening a link has no id to auth as yet, and
// the lookup exposes nothing new — you must already hold an id to query it, and
// holding it already grants full sign-in as that user (ids are not secrets; see
// client/util/id.ts). Results are returned in input order, null for unknown ids.
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
