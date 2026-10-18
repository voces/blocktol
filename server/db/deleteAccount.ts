import { sql } from "./query.ts";

// A player's "delete my data" (GDPR erasure). The run history is kept, because
// runs feed the day's field distribution, other players' percentiles and the
// applied ELO deltas. Instead the player is *anonymized*: the user row's id is
// rotated to a fresh random value that is never handed back, and its
// identifying fields (name, settings, locale) are cleared. Rating/plays stay.
//
// The single UPDATE to `user.id` carries the runs with it: `FK_run_user ... ON
// UPDATE CASCADE` rewrites every `run.user` to `newId`, so the player remains
// one distinct *anonymous* competitor and the standings' `JOIN user` still
// resolves. The new id is random with no stored old->new mapping, so this is
// anonymization, not pseudonymization.
//
// Push subscriptions, notifications and flags are hard-deleted: a push endpoint
// is a device identifier (and must not stay a live target), and the other two
// are private to the player, with no one else's numbers computed from them.
// They cascade from user anyway, but are deleted by the OLD id before the
// rotation so the intent is on the statement.
//
// `pb_top.top_user` has no FK, so the rotation doesn't reach it and it would
// keep the old id, the player's credential, forever. It is rewritten to the new
// id, which keeps pbBoard's same-holder checks coherent (the column is NOT
// NULL, so NULL isn't an option).
//
// Retry-safe under `sql`'s one retry: the re-run finds no old id, so every
// statement matches zero rows. `newId` is fixed by the caller and reused in the
// retried query, so a retry can't rotate to a second id. One transaction, so it
// commits all-or-nothing.
export const anonymizeUser = (userId: string, newId: string) =>
  sql`
    START TRANSACTION;

    DELETE FROM push_subscription WHERE user = ${userId};
    DELETE FROM notification WHERE user = ${userId};
    DELETE FROM flag WHERE user = ${userId};

    UPDATE pb_top SET top_user = ${newId} WHERE top_user = ${userId};

    UPDATE \`user\`
    SET id = ${newId}, name = NULL, settings = NULL, locale = NULL
    WHERE id = ${userId};

    COMMIT;
  `;
