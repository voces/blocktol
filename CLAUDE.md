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
deno test --allow-net=w3x.io --allow-env=APP_ENV,SQL_PASSWORD,SQL_PROXY_URL common/pathing.test.ts
deno test --allow-net=w3x.io --allow-env=APP_ENV,SQL_PASSWORD,SQL_PROXY_URL --filter "line of sight" server/
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

- `PathSolver` is the one engine: an **exact any-angle shortest path** via a
  visibility graph over obstacle corners with Dijkstra — deliberately _not_
  Theta*, which can settle for slightly-longer routes; optimality is
  test-asserted against a brute-force full-cell visibility graph. `lineOfSight`
  is its swept-square (Liang–Barsky) oracle for the 1×1 runner against blocked
  cells: a segment may _touch_ an obstacle boundary (so a taut path can round a
  corner) but must never cross a blocked cell's interior. Because two
  diagonally-touching blocks leave only a zero-width gap, the runner cannot
  squeeze between them — asserted by the "refuses to squeeze a unit runner
  through a diagonal gap" test in `common/pathing.test.ts`.
- A solver instance precomputes its base board's corners and their pairwise
  visibility once, then each `solve(pieces)` pays only for what the pieces
  change, with a single Dijkstra rooted at the checkpoint settling both legs. On
  top sits an edit-stream layer exploiting that a build is the same maze ± one
  piece per save: recent results are memoized (sorted geometry + thunder flags)
  and a one-piece addition skips the search when the predecessor was unsolvable
  (always sound) or its path is untouched by the new piece (thunder-free boards
  only — the reuse can return a different equal-length path, and near thunders
  geometry is duration-visible). The engine is placement-order-independent by
  construction (ring corners sort row-major), and the layer's contract — a cold
  solver reproduces every warm duration exactly — is fuzz-asserted by the "edit
  stream" test. `cachedSolver` content-addresses one solver per base board
  (LRU); **every surface** — `validateRun`, board/daily/start staging, the
  client's `localRun` preview and its hover/drag validity probes (`solvable`),
  and board generation — goes through the same class, so previewed and persisted
  times share one engine _and one tie-breaking_.
- `pathDuration` turns a path + thunders into `[time, slows]`, **continuously**
  — an event-driven walk (circle/segment in-range intervals, piecewise-linear
  time), not a stepped simulation, so duration is a smooth function of the maze
  rather than being quantized to 0.1-distance ticks. The runner moves at `SPEED`
  (halved while slowed); a thunder within radius 4 triggers at the earliest
  instant strictly in range with its 3.2s cooldown passed, resetting the shared
  6s slow (never stacking); exact ties fire together. Times round to the two
  decimals the game stores.
- Placement legality lives in `server/util/validateRun.ts` (`validateRun`) — it
  reuses the same engine (via `cachedSolver`, per iteration shape), so what the
  audit script accepts is exactly what the write path accepts. Any change that
  shifts timing or equal-length tie-breaking requires a
  `scripts/comparePathing.ts` audit/retime before it ships.

## Server architecture

**Entry (`server/index.ts`):** import-side-effect registers the crons
(`util/gen.ts`, `util/rateDailies.ts`), then **binds the port immediately** and
runs pending migrations (best-effort, never crash-loops) in the background. A
`ready` gate makes each request `await` the migration before routing — so a
redeploy's fresh process starts accepting connections without waiting on the
migration DB round-trip (the cohost's single nginx upstream 502s while the port
is unbound), yet a request is never served against a schema the code predates.
Most deploys carry no pending migration, so `ready` resolves at once; a
migration deploy briefly holds requests instead of dropping them.
(`deno task start` runs with `--no-check` — CI's `deno check`/`test` is the type
gate — so boot skips the redundant local type-check, further shrinking the
restart gap.)

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

A `/YYYYMMDD` **permalink cold-load** boots through the same one request:
`primeBoot` passes the URL's date as `boot`'s optional `day`, and boot resolves
it to an iteration and _also_ bundles that day's
`linked: { iteration, board,
standings }` (non-soft `getBoard` + `standings`,
same composition as `dayView`). `primeBoot` then primes the three calls the
deep-link handler fires for that day — by-date `standings` (what
`consumeDeepLink` resolves the id with), then `getBoard` and `standings` **by
iteration** (the id is only known once boot lands, so those two primes are set
in boot's `.then`). Because the pool is content-keyed, the linked day's
iteration-keyed calls never collide with today's timezone-keyed primes — today's
slices still feed the dock/calendar/summary while the linked day feeds the
staged board. An unresolvable date (or a linked slice that can't be served)
throws, so the consumer falls through to its own fetch — the old skip-boot
day-link path is gone. `entryIsDayLink` still gates today-**staging** so the
linked day wins the board (`useInit`).

**`dayView` is boot for one arbitrary day.** `routes/dayView.ts` composes
`getBoard` (non-soft) + `standings` for a chosen `{ iteration, timeZone }` —
because a day navigation (a calendar click, view-best) fires exactly those two:
`getBoard` from `showBoard`, and `standings` as the dock reacts to the iteration
change. `client/store/board.ts`'s `showDay(iteration)` fires the one `dayView`,
then `primeFrom` (the general form of `primeBoot`'s slicing — `client/api.ts`)
primes each slice under the exact input its consumer sends: `getBoard` under
`{ iteration, timeZone }`, and `standings` under `{ timeZone }` when the day is
today (the dock keys today by timezone) or `{ iteration }` for a past day — then
delegates to `showBoard`. Both methods are `RETRYABLE`, so a primed slice that
fails at transport falls through to a real fetch. `Calendar` (cross-day pick)
and `Profile` (view-best) call `showDay`; same-day re-stage, deep-links, and
gameplay stay on `showBoard`.

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

**Crons (`Deno.cron`, single non-overlapping writer; both skip registration when
`DISABLE_CRONS` is set, so a second instance sharing the DB doesn't
double-write):**

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
  _practical_ floor, not a strict one: the solver minimizes distance, not time,
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
- **Data rights (GDPR export / erasure):** two authed API methods, both surfaced
  in Profile → Account. `exportData` (`routes/exportData.ts` → `db/export.ts`)
  returns everything held about the caller (user row, all runs incl. void,
  notifications, push endpoints) as one JSON document the client offers as a
  download. `deleteAccount` (`routes/deleteAccount.ts` → `db/deleteAccount.ts`,
  `anonymizeUser`) is **anonymize-in-place, not a row delete**: it hard-deletes
  the caller's push subscriptions + notifications, then rotates `user.id` to a
  fresh random UUID and clears `name`/`settings`/`locale`. The runs ride along
  via `FK_run_user ON UPDATE CASCADE`, so the player's build history survives as
  one distinct **anonymous** competitor — the day's field, others' percentiles,
  and the applied ELO deltas aren't rewritten, and every `JOIN user` still
  resolves. The new id is never returned, so the link to the person is gone
  (anonymization, not pseudonymization). The op is an idempotent no-op on retry
  (the old id is gone), but `deleteAccount` is still **excluded from the client
  `RETRYABLE` allowlist** because on success the client mints a fresh local id +
  reloads, so a blind retry would act on the stale id. The confirm is gated
  behind typing "DELETE" (`DeleteAccount.tsx`). `public/privacy.html` is the
  static disclosure page linked from the same panel (the SQL proxy is
  first-party infra, not listed as a third-party recipient).

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
allowlist — non-idempotent lifecycle writes (`startRun`/`merge`, and
`updateRun`, which has its own saver) are deliberately excluded. `commitRun`
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
recents. Navigating away mid-build (reviewing a maze, another day) deliberately
does NOT abandon the build — the record stays, and staging its board within the
window resumes it. Its window doesn't pause either: reviewing a past maze keeps
the live countdown in the HUD's Play slot alongside the reset button, and reset
there clears the attempt while staying on the reviewed maze (the input hooks
gate on `viewing`, so the ticking clock never makes a reviewed board editable).
Should the window expire mid-review, the board hands back to the build (restored
from the local record via `pendingFreePlay`, the one read that ignores the
deadline) and it executes normally — committed, runner released.
`useClock`/`RunClock` run the 60s/animation timing; `verdict.ts` computes the
result.

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
drop the internet round-trip), `DISABLE_CRONS` (any non-empty value skips
registering the `ensure-iterations`/`rate-dailies` crons — for a second instance
on the shared DB), `NEW_RELIC_API_KEY`,
`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (Web Push; generate with
`deno run scripts/genVapidKeys.ts`; until set, notifications stay in-app), and
`DISCORD_ADMIN_WEBHOOK_URL` (a Discord webhook URL for fire-and-forget operator
alerts via `util/adminAlert.ts` — plain REST, no bot token / discord.js; unset =
alerts are no-ops). The task definitions enumerate the exact `--allow-env`
grants.

**Observability (OpenTelemetry).** Blocktol uses Deno's **built-in** OTel
(`OTEL_DENO=true`), which auto-instruments `Deno.serve` requests, outbound
`fetch` (the SQL proxy hop), and crons — so tracing is **env-configured, not
code**: there is no OTel SDK wiring in the source, and these vars are read by
the runtime's telemetry subsystem, **not** user code, so they need no
`--allow-env` grant (and `start`/`dev` already use bare `--allow-net`).
Spans/logs export over OTLP/HTTP to a **self-hosted** VictoriaTraces +
VictoriaLogs on the w3x.io box (first-party infra, same as the SQL proxy — not a
third-party recipient). The per-signal endpoints are set because VictoriaTraces
(`:10428`) and VictoriaLogs (`:9428`) use non-standard ingest paths and Deno
appends the standard `/v1/*` otherwise: `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`
(…`/insert/opentelemetry/v1/traces`), `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`
(…`/insert/opentelemetry/v1/logs`), `OTEL_EXPORTER_OTLP_HEADERS` (the
`Authorization: Bearer` for `victoria.w3x.io`, since Deno Deploy isolates reach
it over the public internet, not localhost), `OTEL_METRICS_EXPORTER=none`
(neither backend ingests metrics), and `OTEL_SERVICE_NAME=blocktol`. Runs
alongside New Relic (`NEW_RELIC_API_KEY`) for now; New Relic is to be retired
once the self-hosted pipeline is proven, which also drops that US third-party
transfer. Any user-id tagging on spans must use a **hashed** id, never the raw
`authorization` credential.

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
