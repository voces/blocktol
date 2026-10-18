import { z } from "zod";
import { anonymizeUser } from "../db/deleteAccount.ts";
import { method } from "./apiHelpers.ts";

// "Delete my data" (GDPR erasure). Possession of the header id is the
// authorization (as in merge) and a caller can only name themselves, so no
// server-side confirmation token; the client gates it behind a typed "DELETE".
// The id is rotated to a fresh random UUID and identifying fields are cleared;
// run history survives, severed from the person (see db/deleteAccount.ts). The
// client then mints a new local id.
export const deleteAccount = method(z.object({}).optional(), true)(
  async ({ userId }) => {
    await anonymizeUser(userId, crypto.randomUUID());
    return { deleted: true };
  },
);
