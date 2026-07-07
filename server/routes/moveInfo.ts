import { z } from "zod";
import { getUser } from "../db/user.ts";
import { nonVoidRunCount } from "../db/merge.ts";
import { method } from "./apiHelpers.ts";

// Summarize one or two profiles by id — display name and data size (non-void run
// count, the "games" figure). Drives the move/merge gate when a sign-in link
// opens on a device that already has a profile: the client looks up its own id
// and the link's id to decide between a silent merge, the fork, or a clean adopt.
//
// Unauthed by design: a clean device opening a link has no id to auth as yet, and
// the lookup exposes nothing new — you must already hold an id to query it, and
// holding it already grants full sign-in as that user (ids are not secrets; see
// client/util/id.ts). Results are returned in input order, null for unknown ids.
const summaryBody = z.object({
  ids: z.array(z.string().trim().min(1).max(36)).min(1).max(2),
});

export const moveInfo = method(summaryBody)(
  ({ ids }) =>
    Promise.all(ids.map(async (id) => {
      const user = await getUser(id);
      if (!user) return null;
      return { id, name: user.name, games: await nonVoidRunCount(id) };
    })),
);
