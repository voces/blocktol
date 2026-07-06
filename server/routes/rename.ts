import { z } from "zod";
import { updateUserName } from "../db/user.ts";
import { method } from "./apiHelpers.ts";

// Trimmed, bounded to the `name` column's 32 chars. An empty name (all
// whitespace) is rejected rather than blanking the profile.
const renameBody = z.object({
  name: z.string().trim().min(1).max(32),
});

export const rename = method(renameBody, true)(
  async ({ userId, name }) => {
    const user = await updateUserName(userId, name);
    return { name: user?.name ?? name };
  },
);
