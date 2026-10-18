import { z } from "zod";
import { getUserRivals } from "../db/user.ts";
import { method } from "./apiHelpers.ts";

// Every rival the player has a head-to-head record against, for the sheet
// behind the profile's short list. Separate from `getProfile` because that
// rides on boot and a full list shouldn't be fetched before anyone asks.
export const rivals = method(z.object({}).optional(), true)(
  ({ userId }) => getUserRivals(userId),
);
