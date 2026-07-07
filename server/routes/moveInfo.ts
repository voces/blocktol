import { z } from "zod";
import { getUser } from "../db/user.ts";
import { nonVoidRunCount } from "../db/merge.ts";
import { method } from "./apiHelpers.ts";

// The two profiles a device is deciding between when a sign-in link opens on a
// device that already has a profile: the authed one (this device's local id) and
// `other` (the id from the link). Returns each side's display name and its data
// size — non-void run count, the "games" figure the fork screen shows and the
// number the silent-merge threshold compares. `other` is null when the link id
// has no user row yet (a clean adopt, not a fork).
const moveInfoBody = z.object({
  other: z.string().trim().min(1).max(36),
});

const side = async (id: string) => {
  const user = await getUser(id);
  if (!user) return null;
  return { id, name: user.name, games: await nonVoidRunCount(id) };
};

export const moveInfo = method(moveInfoBody, true)(
  async ({ userId, other }) => ({
    self: await side(userId),
    other: other === userId ? null : await side(other),
  }),
);
