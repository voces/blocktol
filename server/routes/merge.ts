import { z } from "zod";
import { getUser } from "../db/user.ts";
import { mergeUsers } from "../db/merge.ts";
import { method } from "./apiHelpers.ts";

// Fold two profiles into one. The caller is authed as one id (the header) and
// supplies the other id it possesses (its local id, or the id from the sign-in
// link it just opened). `primary` names which of the two survives — "self" keeps
// the authed id, "other" keeps the supplied one. The loser's runs move to the
// winner and the loser's user row is deleted.
//
// Possession of both ids is the authorization: ids ride the auth header and are
// not secrets (see client/util/id.ts), and the only way to hold the other id is
// to be the device that owns it or to have opened its link.
const mergeBody = z.object({
  other: z.string().trim().min(1).max(36),
  primary: z.enum(["self", "other"]),
});

export const merge = method(mergeBody, true)(
  async ({ userId, other, primary: which }) => {
    if (other === userId) {
      return { error: "cannot merge a profile into itself" };
    }

    const primary = which === "self" ? userId : other;
    const secondary = which === "self" ? other : userId;

    // The secondary must exist to merge; if it doesn't, treat it as an
    // already-clean no-op rather than an error (e.g. a link to a never-seeded id).
    if (!(await getUser(secondary))) return { primary, merged: false };

    await mergeUsers(primary, secondary);
    return { primary, merged: true };
  },
);
