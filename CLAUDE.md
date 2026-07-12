# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## What Blocktol is

A daily competitive maze-building game (PWA). Each day the server generates one
puzzle (an "iteration"): a 20×20 grid with a border ring, a checkpoint, and some
fixed blocks/thunders. A "runner" travels start `(9,19)` → checkpoint → end
`(10,0)` along the **exact any-angle shortest path**. The player spends a budget
of blocks (`bricks`) and slow-fields (`power`, "thunders") over a 60-second
window to force that path longer. **Higher time is better** — you are
lengthening the runner's route, not racing it. Your best of your first three
attempts is your _ranked_ result; percentile within the day's field drives an
ELO-style rating.

There is no login/password. Identity is a per-device UUID sent as the
`authorization` header (see the identity model below).

## Commands

Everything is a Deno task (`deno.jsonc`). Deno v2.x; no `package.json`, no
bundler config.

```bash
deno task dev        # bundle (watch) + run server (watch) — local dev
deno task start      # run the server once (prod-style)
deno task build      # bundle client -> public/js/{index.js,pathing.js}
deno task test       # run the test suite
deno task migrate    # apply pending DB migrations (usually automatic on boot)
deno task preview    # static-serve ./ (inspect public/ pages)

deno fmt             # format (CI runs `deno fmt --check`; markdown included)
deno check server/index.ts client/index.ts common/pathing.ts   # typecheck (CI does this)
```

Run a **single test file / filter**:

```bash
deno test --allow-net=w3x.io --allow-env=APP_ENV,SQL_PASSWORD common/pathing.test.ts
deno test --allow-net=w3x.io --allow-env=APP_ENV,SQL_PASSWORD --filter "line of sight" server/
```

Most tests are pure and need no permissions. The `*.test.ts` under
`server/routes/iteration/run/` and a few others are **run-lifecycle integration
tests** that hit the dev database through the SQL proxy; they self-skip unless
`SQL_PASSWORD` is set. CI (`.github/workflows/ci.yml`) runs fmt-check,
typecheck, `deno task test`, then `deno task build`. Deployment is separate —
the Deno Deploy GitHub integration builds and serves `server/index.ts`; the
workflow only checks.

## Layout & the import rule

Three source roots with a strict dependency direction:

- **`common/`** — pure, framework-free logic shared by both sides (the pathing
  engine, domain math, serialization, notification classification, settings
  parsing). Must import nothing from `server/` or `client/`. `client/api.ts`
  imports **types only** from `server/routes/api.ts` — that type-only edge is
  the API contract, not a runtime dependency.
- **`server/`** — the Deno backend. May import `common/`.
- **`client/`** — the Preact frontend, bundled to `public/js/`. May import
  `common/`. JSX uses the `h`/`Fragment` pragma (`preact`), configured in
  `deno.jsonc` — there is no React.

`public/` holds the static shell (`index.html`, `sw.js`, `styles.css`,
`manifest.webmanifest`) plus two standalone debug pages, `pathing.html` and
`distributions.html`, that import the separately-bundled `public/js/pathing.js`
to visualize the pathfinder and the daily-generation distributions.

## The pathing engine (`common/pathing.ts`)

The single most important file; runs identically on server (authoritative
timing, generation, validation) and client (live preview). Do not let the two
diverge — the server's accepted time must equal what the client previewed.

- `findPath` computes an **exact any-angle shortest path** via a visibility
  graph over obstacle corners (`cornerNodes`) with Dijkstra — deliberately _not_
  Theta*, which can settle for slightly-longer routes. `lineOfSight` is a
  swept-square (Liang–Barsky) test for the 1×1 runner against blocked cells: a
  segment may _touch_ an obstacle boundary (so a taut path can round a corner)
  but must never cross a blocked cell's interior. Because two
  diagonally-touching blocks leave only a zero-width gap, the runner cannot
  squeeze between them — asserted by the "refuses to squeeze a unit runner
  through a diagonal gap" test in `common/pathing.test.ts`.
- `pathDuration` turns a path + thunders into `[time, slows]`. Thunders within
  radius 4 apply a temporary slow; the runner steps at `SPEED`. This is where
  "time" comes from.
- `PathSolver` is the same exact search restructured for surfaces that solve
  many placements against one base board: it precomputes the base corners and
  their pairwise visibility once, then each `solve(pieces)` pays only for what
  the pieces change, with a single Dijkstra rooted at the checkpoint settling
  both legs (~3–5× faster; parity with `findPathFromData` is test-asserted). On
  top sits an edit-stream layer exploiting that a build is the same maze ± one
  piece per save: recent results are memoized (sorted geometry + thunder flags)
  and a one-piece addition skips the search when the predecessor was unsolvable
  (always sound) or its path is untouched by the new piece (thunder-free boards
  only — the reuse can return a different equal-length path, and near thunders
  geometry is duration-visible). The engine is placement-order-independent by
  construction (ring corners sort row-major), and the layer's contract — a cold
  solver reproduces every warm duration exactly — is fuzz-asserted by the "edit
  stream" test. `cachedSolver` content-addresses one solver per base board
  (LRU); **every timing surface** — `validateRun`, board/daily/start staging,
  and the client's `localRun` preview — goes through it, so previewed and
  persisted times share one engine _and one tie-breaking_ (equal-length ties can
  break differently from `findPath`, and with thunders duration depends on
  geometry — which is why the `findPath`→`PathSolver` migration called for a
  `scripts/comparePathing.ts` audit/retime). `findPath` remains for grid-shaped
  callers that only consume booleans (hover/drag validity, generation), where
  tie-breaking can't matter.
- Placement legality lives in `server/util/validateRun.ts` (`validateRun`) — it
  reuses the same engine (via `PathSolver`, cached per iteration shape), so what
  the audit script accepts is exactly what the write path accepts.

## Server architecture

**Entry (`server/index.ts`):** import-side-effect registers the crons
(`util/gen.ts`, `util/rateDailies.ts`), runs pending migrations (best-effort,
never crash-loops), then `Deno.serve(router.route)`.

**Router (`server/util/Router.ts` + `server/router.ts`):** a small Express-like
middleware chain over `URLPattern`. Path params are type-derived from the route
string. Every request flows: `beginLogger` → login-link routes → `extractUserId`
→ **`POST /api/:method`** → the `/YYYYMMDD` day-permalink (serves the SPA shell)
→ `staticServe` → `endLogger`. A thrown `UserError` becomes a 400; anything else
is a 500 reported to New Relic.

**The API is one endpoint.** `server/routes/api.ts` owns a `handlers` registry;
`POST /api/:method` looks the method up, zod-validates the body against
`handler.validation`, calls `handler.handler`, and JSON-encodes the result. The
exported `BlocktolApi` type is _derived from the registry_ and is the only thing
the client imports — add a route by adding a `{ validation, handler }` (see
`routes/apiHelpers.ts`'s `method(...)` helper) to that object and the client's
typed `api.<method>()` appears automatically. A handler returning
`{ status: >=500 }` (or throwing) is reported; 4xx are treated as expected
client faults.

**`boot` composes, it doesn't reimplement.** `routes/boot.ts` is one endpoint
that `Promise.all`s the boot handlers (`getDailySummary`, `getProfile`,
`standings`, `getNotifications`, soft `getBoard`, and the current month's
`list`) and bundles their results. Each sub-handler re-derives `userId` from the
request, so their exact semantics — including `getDailySummary`'s server-side
auto-start of the next ranked attempt — carry through unchanged.

The client's `primeBoot` (`client/api.ts`) fires it once and primes each method
with its slice, so every existing call site consumes off the single fetch —
collapsing the old ~8-call, two-wave boot (the second wave was stores refetching
in reaction to the first; the boot standings double-fire is separately guarded
by a freshness check in `store/standings.ts`). The prime is
**content-addressed** (method + serialized input), which is what lets a
parameterized method be bundled: the calendar's two mount months (`list` returns
`[current, prev]`) are each keyed by their month range, so both month fetches
consume off boot (boot derives the two months from the caller's timezone to
match `dailyItems.monthListInput`). `primeBoot` also seeds `todayIteration` from
boot's standings slice so the dock recognizes the staged board as today and
consumes the primed `standings` rather than refetching by id. On a boot failure
each slice rejects and the consumer falls through to its own fetch.

**Database (`server/db/`):** MariaDB reached over HTTP through a SQL proxy at
`w3x.io/sql` (`db/query.ts`) — there is no local DB driver. Two tagged-template
helpers, and the choice is a correctness concern:

- `sql\`...\`` — retries once on transport failure. Use for reads and
  **idempotent** writes (upserts, absolute-value UPDATEs).
- `sqlOnce\`...\`` — no retry. Use for non-idempotent statements (bare INSERTs);
  a retried INSERT after a lost response silently duplicates a row (a spent
  daily attempt, a duplicate iteration).

Multi-statement batches run on one connection, so `@session` variables and
`START TRANSACTION` work across statements — several writes (e.g.
`updateCurrentRun`, `mergeUsers`) rely on this.

**Migrations (`server/db/migrations.ts` + `db/migrate.ts`):** ordered,
contiguous from v1, each run once and recorded in `schema_migration`. A lease
lock elects a single migrator across isolates on boot. **The runner keys off
`version` only — editing an already-shipped migration's SQL never re-runs it.**
So the rule is **append-only once a migration has reached prod**: fix forward
with a new migration. (Editing in place is allowed only while a migration has
_only_ reached dev — see the long note at the bottom of that file.)

**Crons (`Deno.cron`, single non-overlapping writer):**

- `ensure-iterations` (hourly) — generates each day's puzzle through _tomorrow_
  UTC (`util/newIteration.ts` builds a random solvable board; idempotent, heals
  gaps). Timezones ahead of UTC hit a new local day first, hence the look-ahead.
- `rate-dailies` (:30 hourly) — rates each daily once its date is closed across
  _all_ timezones (~37h after creation), writes ELO deltas (`util/rating.ts`,
  percentile-based), then fires "daily final" notifications.

## Domain model & invariants

Tables: `user`, `iteration`, `block` (an iteration's fixed pieces, kind
`block|thunder`), `run`, `notification`, `push_subscription`. Key run flags —
get these right, they encode the whole competitive model:

- **`ranked`** — this run is one of the daily's three counting attempts.
  Recorded **only at `startRun`**, because it depends on the player's _claimed
  local day_ (from their timezone), and a daily's legal window spans ~50h of
  server time so it can't be inferred later from `created`. Read everywhere
  else.
- **`daily`** — the single _counted_ result among a user's ranked runs (the best
  one). Re-pointed as builds save (`updateCurrentRun`).
- **`void`** — abandoned/not-yet-counted. A **ranked** attempt is inserted at
  `startRun` (void) and clears void on build (`updateCurrentRun`); navigating
  away leaves it void. **Free play** is different: it makes _no server write
  until it executes_ — the build is entirely client-side (see the run-type split
  below), so there is no void free-play row to abandon; `commitRun` **inserts**
  the run already non-void (`insertFreePlayRun`). Void runs are invisible to
  every board/standings/best query.
- **`pinned`** — a player's bookmark that floats a run to the top of their own
  Attempts panel. The panel merges runs that built the identical maze into one
  row, so pinning toggles the whole maze-group together.

Other invariants:

- **The run lifecycle splits by type, to keep request volume down and survive
  deploys.** A **ranked** attempt keeps the server bookends: `startRun` (stamps
  `ranked`, opens the authoritative 60s window) and per-build `updateRun`s — now
  **debounced** in `runSaver.ts` (a burst of placements collapses to one save),
  except the final seconds save immediately so the executed maze is confirmed
  before the window closes. **Free play** makes _no_ server round trips during
  the build: the client computes the path locally (`localRun`, the same engine
  the server runs), enforces the 60s window itself, mirrors the in-progress maze
  to `localStorage` (resume across reload — `freePlay.ts`), and touches the
  server exactly once, at execution, via `commitRun`. That commit is a single
  idempotent `INSERT` keyed by a client-generated `client_id` (migration v8), so
  it is **retryable**: a connection dropped by a deploy retries onto a fresh
  isolate and lands rather than losing the run. `commitRun` stays backwards
  compatible — a legacy cached client that still
  `startRun`+`updateRun`+bare-committed hits the old flip-void path (no
  `blocks`). Trusting the client on free play is deliberate: it's post-ranked,
  never feeds ELO, and the server still recomputes the time from the submitted
  maze — only the 60s budget is client-enforced.
- **Free play unlocks only after the day's three ranked attempts are spent**
  (`getBoard` gates on it), and since "today" is the latest day, that also
  unlocks every past day for replay.
- `standing(time, min, best)` (`common/standing.ts`) is the one shared
  position-in-field formula used by every surface; `min` is the time of the base
  board's unobstructed shortest path, stored on the iteration. It's a
  _practical_ floor, not a strict one: `findPath` minimizes distance, not time,
  so a maze that reroutes the runner clear of a fixed thunder's slow can in
  principle come in under it (see `scripts/comparePathing.ts`) — `standing`
  clamps a below-`min` time to 0.
- **Identity / move / merge:** the UUID in the `authorization` header _is_ the
  bearer credential — there's no password, so possession alone _is_ the whole
  authorization. That's a sensitive credential: anyone who obtains it can act as
  (or merge away) that user, so it must be protected like one. But possession is
  deliberately made _sufficient_ — that's exactly what powers "move to device":
  it issues a `/login/:id` (or `/l/:id`) link/QR, and holding two ids authorizes
  folding them (`routes/merge.ts` → `db/merge.ts` reassigns runs and deletes the
  loser row in one transaction). The client-side gate is
  `MoveGate`/`MoveDevice`.

## Client architecture

**Boot (`client/index.ts`):** installs error reporting → applies cached theme →
**primes** the boot API calls (fires them during module eval, before first
render, so round trips overlap) → renders `App` inside an `ErrorBoundary` →
registers the service worker. A `/YYYYMMDD` deep-link boot deliberately skips
priming today's board/standings so it can stage the linked day instead.

**API client (`client/api.ts`):** a `Proxy` typed as `BlocktolApi` —
`api.foo(x)` POSTs to `/api/foo`. It also _is_ an event emitter (every
successful response dispatches an event keyed by method; `error` is its own
channel), which `hooks/useApiListener.ts` and the stores subscribe to. `prime()`
stashes an in-flight boot response for the next call of that method to consume.
Retries (transport failures only, never HTTP errors) are gated by a `RETRYABLE`
allowlist — non-idempotent lifecycle writes (`startRun`/`abandonRun`/`merge`,
and `updateRun`, which has its own saver) are deliberately excluded. `commitRun`
**is** retryable: its free-play `INSERT` is `client_id`-guarded (idempotent) and
the legacy path is an idempotent flip-to-non-void, so a deploy-dropped commit
can safely retry.

**State — `@preact/signals`, not context** (writes bypass the render path):

- `client/store/*` are module-level signal stores fed by the api emitter:
  `board` (normalized per-iteration board cache + `showBoard`/`startBoardRun`
  loaders with a monotonic seq token so out-of-order responses can't stage a
  stale board), `standings`, `profile`, `notifications`, `notifNav` (deep-link
  routing — effectively the app's router), `connection` (drives the Disconnected
  overlay), `dailyItems`, `discord`. `store/query.ts` is not a data store but
  the shared coalesce/dedupe/stale-window cache primitive the others build on.
- `client/components/Game/interaction.ts` holds pointer-frequency board state as
  signals so a drag only re-renders the board, not the tree.

**The game loop (`client/components/Game/`):** `useGameState` + `useInit` wire
the board handlers; `interaction.ts`/`useInputStart`/`useInputEnd` handle
placement. Every placement recomputes the runner locally (`localRun` in
`helpers.ts`, on the same shared `cachedSolver` the server validates with) so
the board updates with no round trip; **persistence then splits by run type**
(see the run lifecycle above). **Ranked** goes through `runSaver.ts` — a
**trailing-edge queue of depth 1** (every save sends the full maze, newer saves
coalesce, failures retry with backoff), now **debounced** except in the final
seconds. At run start `flushRunSaver` **sends** the pending maze immediately
(rather than reverting to the last confirmed one — that would drop a debounced
edit the player hasn't waited out, e.g. tapping "Ready?" mid-build); if the
window has already closed the flush comes back expired and `onExpired` snaps the
board back. **Free play** bypasses the saver entirely: `freePlay.ts` mints the
per-attempt `client_id`, mirrors the maze to `localStorage` for reload-resume,
and `commitRun` fires once at execution; `useInit` awaits that commit before
re-staging so a slow (retrying) commit can't let the re-stage drop the run from
recents. `useClock`/`RunClock` run the 60s/animation timing; `verdict.ts`
computes the result.

**Push notifications:** `common/notifications.ts` is the shared, framework-free
domain (the five-way `classifyDailyOutcome`, and `notificationText` so push copy
and the in-app panel never drift). In-app notifications are always written; push
delivery is opt-in per kind (`common/settings.ts`) and needs VAPID keys set.
`public/sw.js` is the service worker.

## Environment variables

`PORT` (local only; the platform manages it in prod), `APP_ENV` (`dev`/`prod` —
selects the proxy database `blocktol-<env>`), `SQL_PASSWORD`, `SQL_PROXY_URL`
(the SQL proxy endpoint; defaults to `https://w3x.io/sql` — set to the proxy's
localhost address when the server is co-located with it, e.g. the EC2 cohost, to
drop the internet round-trip), `NEW_RELIC_API_KEY`, and
`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (Web Push; generate with
`deno run scripts/genVapidKeys.ts`; until set, notifications stay in-app). The
task definitions enumerate the exact `--allow-env` grants.

## Operational scripts (`scripts/`)

Dry-run by default, `--apply` to write; run locally against an env with
`APP_ENV=... SQL_PASSWORD=...`:

- `auditRuns.ts` — recompute every non-void run with `validateRun` and delete
  illegal ones.
- `comparePathing.ts` — quantify a pathing change against all stored runs before
  shipping it (with `--apply`, writes recomputed optimal times).
- `comparePathViz.ts`, `genVapidKeys.ts` — path visualization / VAPID keygen.

## Conventions

- This codebase documents intent in **prose comments** — the _why_, edge cases,
  and race conditions are written down at the point of code. Match that style;
  read the surrounding comments before changing timing, run-lifecycle, or
  migration logic, they encode incidents.
- `deno fmt` is authoritative (CI fails on drift). There is no README; this file
  and the inline comments are the documentation.

## Maintaining this file

Keep CLAUDE.md current as part of the change that makes it stale — this is the
"kept up to date" mechanism for an LLM-first doc. Update it when you: add/rename
an API method or route, change a run-lifecycle flag or its invariants, alter the
pathing/timing semantics, add a cron, change build/test commands or env vars, or
add a migration that shifts the schema story. A one-line touch that keeps a
future session from having to re-derive the architecture is worth it.
