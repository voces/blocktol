import { z } from "zod";
import { createOrUpdateUser, getUserStats } from "../db/user.ts";
import { method } from "./apiHelpers.ts";

// The signed-in user's own profile stats (see getUserStats). No input beyond
// the auth header, but the body must still validate — an absent body parses to
// undefined.
export const getProfile = method(z.object({}).optional(), true)(
  async ({ userId }) => {
    // Seed the user row if it doesn't exist yet: boot fetches the profile in
    // parallel with the summary now, so this can win the race against the
    // summary's createOrUpdateUser and must not read a missing row (a blank
    // name). Idempotent upsert; a chosen name is never overwritten.
    await createOrUpdateUser(userId);
    return getUserStats(userId);
  },
);
