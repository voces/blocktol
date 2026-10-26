# server/db — read before touching migrations

**Migrations run automatically on every deploy's boot.**

- Approving a PR's waiting Deploy dev job puts its head on the dev instance,
  which applies every pending migration in `migrations.ts` on that branch to the
  shared `blocktol-dev` database, before review ends.
- Merging to `prod` deploys prod, which applies them to **production**, and the
  dev instance, which applies them to `blocktol-dev` if no approved deploy did.
- Pushing a branch runs nothing.
- Nobody runs migrations by hand. Never ask the user to "run migration vN on
  dev": ask them to approve the PR's dev deploy, then check its effect.

Before asking for a dev deploy of a branch that adds or edits a migration:

1. **Version number.** Check that no other PR has the same version, including
   one deployed to dev and since dropped: whichever reaches dev first is
   recorded, and the other is silently skipped there. This has happened. A draft
   of the board-access change pushed a v16 `preview` table, and the feature was
   dropped before merge. When the real v16 (`user-name-utf8mb4`) arrived, dev
   already had a v16 and skipped it, so emoji renames failed on dev only. The
   fix was by hand: drop the stray table, run the real `ALTER`, and rename the
   `schema_migration` row. When in doubt, ask the user to check dev's
   `schema_migration` for the version you're about to use.
2. **Safe on real data.** Dev holds real-shaped data. Prefer additive changes; a
   `DROP`, a narrowing `MODIFY`, or a data rewrite runs the moment the deploy is
   approved.
3. **Edits after a deploy.** The runner keys off the version alone, so editing a
   migration that dev has already applied does not re-run it. Dev then has to be
   fixed by hand (see the note at the bottom of `migrations.ts`). Once it is on
   prod, it is append-only.
4. **Don't deploy to experiment.** Try the SQL against a local database first.

## The database layer

**Database (`server/db/`):** MariaDB, reached one of **two interchangeable
transports** selected once at boot (`db/query.ts`, `useDirect`):

- **proxy** (default) — HTTP to the SQL proxy at `w3x.io/sql`. Works from
  anywhere (a local run and CI's integration tests use it), needs no DB driver.
- **direct** (`SQL_TRANSPORT=direct`) — the MySQL wire protocol straight to the
  DB via `mysql2` (`db/directTransport.ts`), for the instance **co-located with
  the database** (the w3x.io box); skips the proxy's HTTP hop entirely. mysql2
  is lazily imported only when this transport is selected, so proxy deployments
  never load the driver.

The direct connector is a **transport swap only**: it returns the byte-identical
result shape the proxy does (single statement → its result; multi-statement
batch → an array of per-statement results), with coercion tuned to match the
proxy's JSON (`decimalNumbers` so `ROUND(...)` reads as a number, `dateStrings`
so `created` is the literal timestamp string — the co-located box is UTC), so
**every `server/db/*` caller is untouched**. Both paths honor the same retry
contract below and both are wrapped in a `db.transport`-tagged OTel span
(`db/trace.ts`) — the proxy hop is auto-traced as a `fetch`, but a raw socket is
not, so the direct path would otherwise be a tracing blind spot; the manual span
keeps DB timing visible either way and stamps which transport a query took. The
span carries only the SQL verb + transport, never the statement (it embeds the
raw user-id credential).

Two tagged-template helpers, and the choice is a correctness concern:

- `` sql`...` `` — retries once on transport failure. Use for reads and
  **idempotent** writes (upserts, absolute-value UPDATEs).
- `` sqlOnce`...` `` — no retry. Use for non-idempotent statements (bare
  INSERTs); a retried INSERT after a lost response silently duplicates a row (a
  spent daily attempt, a duplicate iteration).

Both run under a 3s per-attempt timeout that covers the whole response (the
proxy's body read included). A third, `sqlMigrate`, has **no retry and no
timeout** and is for `db/migrate.ts` only — a long ALTER must neither be failed
client-side while it keeps running nor re-sent on top of itself.

Multi-statement batches run on one connection, so `@session` variables and
`START TRANSACTION` work across statements — several writes (e.g.
`updateCurrentRun`, `mergeUsers`, `applyRatings`, `createIteration`) rely on
this. The direct transport checks out its connection explicitly so it can clean
up after a failure: a server error mid-batch is `ROLLBACK`ed before the
connection goes back to the pool (otherwise the next borrower inherits the open
transaction), and a transport error or timeout destroys it. It also bounds the
wait for a pooled connection (5s acquire timeout, 500-deep queue).

**Migrations (`server/db/migrations.ts` + `db/migrate.ts`):** applied on boot —
so an approved dev deploy applies a branch's migrations to dev (see the warning
at the top). Ordered, contiguous from v1, each run once and recorded in
`schema_migration`. A lease lock elects a single migrator across processes on
boot; the holder renews its 60s lease every 20s while it works, and the losers
**wait** (polling, retrying the lease in case the winner died; capped at 15 min,
then a logged/alerted throw) until the target version is recorded — so no
process opens its `ready` gate onto a half-migrated schema. **The runner keys
off `version` only — editing an already-shipped migration's SQL never re-runs
it.** So the rule is **append-only once a migration has reached prod**: fix
forward with a new migration. (Editing in place is allowed only while a
migration has _only_ reached dev — see the long note at the bottom of that
file.) Every user-text column is utf8mb4 (v16 moved `user.name`, the last
utf8mb3 holdout, so an emoji display name stores; `rename` answers any remaining
DB refusal as a 400).
