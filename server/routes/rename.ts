import { z } from "zod";
import { SQLError } from "../db/directTransport.ts";
import { updateUserName } from "../db/user.ts";
import { log } from "../util/logging.ts";
import { UserError } from "../util/UserError.ts";
import { method } from "./apiHelpers.ts";

// Trimmed, bounded to the `name` column's 32 chars. The column counts code
// points, so an emoji (two UTF-16 units) counts once, as it does there. An
// empty name (all whitespace) is rejected rather than blanking the profile.
const renameBody = z.object({
  name: z.string().trim().min(1).refine((s) => [...s].length <= 32, {
    message: "Name too long",
  }),
});

export const rename = method(renameBody, true)(
  async ({ userId, name }) => {
    try {
      const user = await updateUserName(userId, name);
      return { name: user?.name ?? name };
    } catch (err) {
      // The database refusing the value (a character the column can't store)
      // is the name's fault, not the server's: a 400, not a 500.
      if (!(err instanceof SQLError)) throw err;
      log.warn("rename rejected by db", { error: err.message });
      throw new UserError("Name not accepted");
    }
  },
);
