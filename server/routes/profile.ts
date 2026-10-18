import { z } from "zod";
import { createOrUpdateUser, getUserStats } from "../db/user.ts";
import { method } from "./apiHelpers.ts";

// The signed-in user's profile stats (see getUserStats). No input; an absent
// body parses to undefined, hence `.optional()`.
export const getProfile = method(z.object({}).optional(), true)(
  async ({ userId }) => {
    // Boot runs this in parallel with the summary, so it can beat the
    // summary's createOrUpdateUser and must not read a missing row. Idempotent;
    // never overwrites a chosen name.
    await createOrUpdateUser(userId);
    return getUserStats(userId);
  },
);
