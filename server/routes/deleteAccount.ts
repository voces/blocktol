import { z } from "zod";
import { anonymizeUser } from "../db/deleteAccount.ts";
import { alertAdmin } from "../util/adminAlert.ts";
import { hashUserId } from "../util/hashUserId.ts";
import { method } from "./apiHelpers.ts";

// "Delete my data" (GDPR erasure). Possession of the header id is the
// authorization (as in merge) and a caller can only name themselves, so no
// server-side confirmation token; the client gates it behind a typed "DELETE".
// The id is rotated to a fresh random UUID and identifying fields are cleared;
// run history survives, severed from the person (see db/deleteAccount.ts). The
// client then mints a new local id.
//
// Each erasure also posts the old id's hash (never the id) to the admin
// channel: an off-box ledger, so a restore can re-apply deletions made after
// its backup (scripts/reapplyErasures.ts) even if the box and its logs are
// lost with it.
export const deleteAccount = method(z.object({}).optional(), true)(
  async ({ userId }) => {
    await anonymizeUser(userId, crypto.randomUUID());
    alertAdmin(`erasure ${await hashUserId(userId)}`);
    return { deleted: true };
  },
);
