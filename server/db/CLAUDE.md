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

1. **Version number.** Check that no other open branch uses the same version.
   Both would be applied to dev, and the second one is recorded as already done
   and silently skipped.
2. **Safe on real data.** Dev holds real-shaped data. Prefer additive changes; a
   `DROP`, a narrowing `MODIFY`, or a data rewrite runs the moment you push.
3. **Edits after a push.** The runner keys off the version alone, so editing a
   migration that dev has already applied does not re-run it. Dev then has to be
   fixed by hand (see the note at the bottom of `migrations.ts`). Once it is on
   prod, it is append-only.
4. **Don't push to experiment.** Try the SQL against a local database first.
