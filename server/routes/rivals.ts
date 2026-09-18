import { z } from "zod";
import { getUserRivals } from "../db/user.ts";
import { method } from "./apiHelpers.ts";

// Every rival the signed-in player has a head-to-head record against, for the
// sheet behind the profile's short list. Its own call rather than part of the
// profile: the profile rides on boot, and a full field's worth of rows has no
// business being fetched before anyone asks to see it.
export const rivals = method(z.object({}).optional(), true)(
  ({ userId }) => getUserRivals(userId),
);
