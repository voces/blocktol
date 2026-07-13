import { sql } from "./query.ts";

// A player's "delete my data" (GDPR erasure). We do NOT drop the run history —
// runs feed the day's field distribution, other players' percentiles, and the
// already-applied ELO deltas, so deleting them would rewrite history that isn't
// only the leaving player's. Instead we *anonymize*: sever the runs from the
// person by rotating the user row's id to a fresh random value that is never
// handed back to anyone, and clear the identifying fields (name, settings,
// locale) on that row. Rating/plays stay — anonymous game stats now.
//
// The single UPDATE to `user.id` carries the runs with it: the FK
// `FK_run_user ... ON UPDATE CASCADE` rewrites every `run.user` to `newId` in the
// same statement, so the leaving player survives as one distinct *anonymous*
// competitor (the standings' `JOIN user` still resolves — a row still exists),
// rather than collapsing into a shared bucket or vanishing from the join. The new
// id is a random UUID with no stored old->new mapping, so this is anonymization,
// not pseudonymization — nothing left ties the retained rows to the person.
//
// The device-identifying rows are hard-deleted rather than carried over: the push
// endpoint *is* a device identifier (and we must not keep a live push target for a
// deleted account), and notifications are per-user history nothing else depends
// on. Both have `ON DELETE CASCADE` to user, but we delete them explicitly by the
// OLD id before the rotation so the intent is on the statement, not a side effect.
//
// Retry-safe under `sql`'s one retry: a lost response re-runs the whole batch, but
// by then the old id no longer exists, so the DELETEs and the UPDATE all match
// zero rows — a harmless no-op. `newId` is fixed by the caller and reused verbatim
// in the retried query string, so a retry can't rotate to a second id. One round
// trip, one connection, wrapped in a transaction so it commits all-or-nothing.
export const anonymizeUser = (userId: string, newId: string) =>
  sql`
    START TRANSACTION;

    DELETE FROM push_subscription WHERE user = ${userId};
    DELETE FROM notification WHERE user = ${userId};

    UPDATE \`user\`
    SET id = ${newId}, name = NULL, settings = NULL, locale = NULL
    WHERE id = ${userId};

    COMMIT;
  `;
