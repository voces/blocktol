import { z } from "zod";
import {
  createOrUpdateUser,
  ensurePublicId,
  getUserStats,
} from "../db/user.ts";
import { method } from "./apiHelpers.ts";

// The signed-in user's own profile stats (see getUserStats), plus their public
// slug so the client can build the shareable `/u/<slug>` link. No input beyond
// the auth header, but the body must still validate — an absent body parses to
// undefined.
export const getProfile = method(z.object({}).optional(), true)(
  async ({ userId }) => {
    // Seed the user row if it doesn't exist yet: boot fetches the profile in
    // parallel with the summary now, so this can win the race against the
    // summary's createOrUpdateUser and must not read a missing row (a blank
    // name). Idempotent upsert; a chosen name is never overwritten.
    await createOrUpdateUser(userId);
    // Assign the public slug on first profile load (the row now exists), so the
    // share affordance always has one; idempotent thereafter.
    const publicId = await ensurePublicId(userId);
    const stats = await getUserStats(userId);
    return { ...stats, publicId };
  },
);
