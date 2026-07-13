import { z } from "zod";
import { anonymizeUser } from "../db/deleteAccount.ts";
import { method } from "./apiHelpers.ts";

// "Delete my data" (GDPR erasure). Authed by the header id alone — possession of
// the id is the authorization (same model as merge), and a caller can only ever
// name themselves, so no extra confirmation token is needed server-side (the
// client gates the destructive action behind a typed-"DELETE" confirm). The id is
// rotated to a fresh random UUID and the identifying fields are cleared; the run
// history survives, severed from the person (see db/deleteAccount.ts). The client
// then mints a brand-new local id, so the device starts over as a new player.
//
// No input beyond the auth header, but the body must still validate (an absent
// body parses to undefined).
export const deleteAccount = method(z.object({}).optional(), true)(
  async ({ userId }) => {
    await anonymizeUser(userId, crypto.randomUUID());
    return { deleted: true };
  },
);
