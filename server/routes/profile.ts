import { z } from "zod";
import { createOrUpdateUser, getUserStats } from "../db/user.ts";
import { dailyDate } from "../util/dailyParts.ts";
import { method } from "./apiHelpers.ts";

// The signed-in user's own profile stats (see getUserStats).
//
// `timeZone` is the caller's, as every daily-facing method takes it, and it is
// what the free-play tally's "Boards" total and the streak are measured
// against. It's OPTIONAL only so a legacy cached client that still posts `{}`
// keeps working; that path falls back to UTC — the old behaviour — rather than
// failing. An absent body parses to `{}` via the default, so the method stays
// callable with no body at all.
const getProfileBody = z.object({ timeZone: z.string().optional() }).default(
  {},
);

export const getProfile = method(getProfileBody, true)(
  async ({ userId, timeZone }) => {
    // Seed the user row if it doesn't exist yet: boot fetches the profile in
    // parallel with the summary now, so this can win the race against the
    // summary's createOrUpdateUser and must not read a missing row (a blank
    // name). Idempotent upsert; a chosen name is never overwritten.
    await createOrUpdateUser(userId);
    const today = timeZone === undefined
      ? new Date().toISOString().slice(0, 10)
      : dailyDate(timeZone);
    return getUserStats(userId, today);
  },
);
