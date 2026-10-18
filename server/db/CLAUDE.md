# server/db — read before touching migrations

**Migrations run automatically, and a push is a deploy.**

- Pushing **any** branch deploys a Deno Deploy dev preview. It boots against the
  shared `blocktol-dev` database and applies every pending migration in
  `migrations.ts` on that branch, before anyone has reviewed it.
- Merging to `prod` deploys the EC2 instance, which applies them to
  **production** on boot.
- Nobody runs migrations by hand. Never ask the user to "run migration vN on
  dev": the push already did. Ask them to check its effect instead.

Before pushing a branch that adds or edits a migration:

1. **Version number.** Check that no other branch has pushed the same version,
   including one since abandoned or dropped before merge: whichever reaches dev
   first is recorded, and the other is silently skipped there. This has
   happened. A draft of the board-access change pushed a v16 `preview` table,
   and the feature was dropped before merge. When the real v16
   (`user-name-utf8mb4`) arrived, dev already had a v16 and skipped it, so emoji
   renames failed on dev only. The fix was by hand: drop the stray table, run
   the real `ALTER`, and rename the `schema_migration` row. When in doubt, ask
   the user to check dev's `schema_migration` for the version you're about to
   use.
2. **Safe on real data.** Dev holds real-shaped data. Prefer additive changes; a
   `DROP`, a narrowing `MODIFY`, or a data rewrite runs the moment you push.
3. **Edits after a push.** The runner keys off the version alone, so editing a
   migration that dev has already applied does not re-run it. Dev then has to be
   fixed by hand (see the note at the bottom of `migrations.ts`). Once it is on
   prod, it is append-only.
4. **Don't push to experiment.** Try the SQL against a local database first.
