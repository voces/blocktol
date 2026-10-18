import { z } from "zod";
import { getUser } from "../db/user.ts";
import { mergeUsers } from "../db/merge.ts";
import { method } from "./apiHelpers.ts";

// Fold two profiles into one. The caller is authed as one id (the header) and
// supplies the other (its local id, or the id from a sign-in link). `primary`
// picks the survivor: "self" keeps the authed id, "other" the supplied one. The
// loser's runs move to the winner and its user row is deleted.
//
// Possession of both ids is the authorization (see client/util/id.ts).
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

    // A missing secondary is a no-op (e.g. a link to a never-seeded id). A
    // missing primary is a 400 (mistyped or stale link id): moved runs would
    // point at no user row and die on the run FK as a 500.
    const [primaryRow, secondaryRow] = await Promise.all([
      getUser(primary),
      getUser(secondary),
    ]);
    if (!secondaryRow) return { primary, merged: false };
    if (!primaryRow) return { error: "unknown profile", status: 400 };

    await mergeUsers(primary, secondary);
    return { primary, merged: true };
  },
);
