import { z } from "zod";
import { getUserStats } from "../db/user.ts";
import { method } from "./apiHelpers.ts";

// The signed-in user's own profile stats (see getUserStats). No input beyond
// the auth header, but the body must still validate — an absent body parses to
// undefined.
export const getProfile = method(z.object({}).optional(), true)(
  ({ userId }) => getUserStats(userId),
);
