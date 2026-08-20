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
  engine, the splits derived from it, domain math, serialization, notification
  classification, settings parsing). Must import nothing from `server/` or
  `client/`. `client/api.ts` imports **types only** from `server/routes/api.ts`
  — that type-only edge is the API contract, not a runtime dependency.
- **`server/`** — the Deno backend. May import `common/`.
- **`client/`** — the Preact frontend, bundled to `public/js/`. May import
  `common/`. JSX uses the `h`/`Fragment` pragma (`preact`), configured in
  `deno.jsonc` — there is no React.

`public/` holds the static shell (`index.html`, `sw.js`, `styles.css`,
`manifest.webmanifest`), the icon/social assets (`favicon.svg` plus PNGs
regenerated from its mark: transparent `icon-192.png`/`icon-512.png` for the
manifest's `purpose:"any"`, but opaque brand-bg `icon-maskable-512.png` and
`apple-touch-icon.png` — maskable icons must be full-bleed, and iOS composites
the home-screen icon onto black so alpha is pointless there — and the `og.png`
share card), `robots.txt`, and two standalone debug pages, `pathing.html` and
`distributions.html`, that import the separately-bundled `public/js/pathing.js`
to visualize the pathfinder and the daily-generation distributions. The shell
**does** carry Open Graph / Twitter tags (the Reddit/search share card points at
`og.png`); chat-app unfurls are suppressed instead at the crawler level —
`robots.txt` disallows `Discordbot`/`Slackbot`, which build embeds server-side
and honor it — so a shared link stays a plain link in chat while a Reddit post
still gets a card. Don't "fix" the missing-embed-in-Discord by removing the og
tags; that's the intended split.

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
  decimals the game stores. The walk itself is `pathTimeline`, which
  `pathDuration` is a rounding wrapper over: it also returns each node's
  cumulative distance, a closed-form `timeAt(distance)` (its state is recorded
  at every trigger, so any point on the route resolves without re-walking), and
  per slow the seconds of slow the trigger **destroyed** by resetting a
  still-running one (plus, on the last, whatever was still owed at the finish).
  `circleWindows` is the shared geometry — a thunder's trigger windows and a
  flag's passes are the same circle/polyline intersection (for a flag the window
  only says it WAS passed; the mark is timed at the closest approach within it,
  so a flag on the checkpoint reads the checkpoint's own time rather than half a
  cell early).
- `common/splits.ts` reads a solved path back as **splits**: the run's time at
  every mark it crosses — each thunder trigger (`local` distinguishing the
  player's piece from the day's), the checkpoint, and the player's flags —
  numbered per kind in crossing order and each carrying a cross-run `key` (the
  piece's cell plus which of ITS crossings this is). `splitDeltas` pairs a run's
  marks against the reference run's **by that key, never by ordinal**: a
  different build routes the runner differently, so the 3rd flag of one run may
  be a different flag entirely. A slow's `wasted` is the timeline's lost slow
  seconds **halved** — at half speed a second of slow only buys half a second of
  finish time, and the tape is about the clock. All of it is pure and derived
  from the path, so the splits panel needs no server data (see the client
  section).
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
is a 500 — logged (`console.error` → VictoriaLogs) and recorded on the request
span (`recordException` → VictoriaTraces).

**The API is one endpoint.** `server/routes/api.ts` owns a `handlers` registry;
`POST /api/:method` looks the method up, zod-validates the body against
`handler.validation`, calls `handler.handler`, and JSON-encodes the result. The
exported `BlocktolApi` type is _derived from the registry_ and is the only thing
the client imports — add a route by adding a `{ validation, handler }` (see
`routes/apiHelpers.ts`'s `method(...)` helper) to that object and the client's
typed `api.<method>()` appears automatically. A handler returning
`{ status: >=500 }` (or throwing) is reported; 4xx are treated as expected
client faults. (`setFlags` — `routes/iteration/flags.ts` — is the splits tape's
one write; see the flags invariant below.)

**`boot` composes, it doesn't reimplement.** `routes/boot.ts` is one endpoint
that `Promise.all`s the boot handlers (`getDailySummary`, `getProfile`,
`standings`, `getNotifications`, `getBoard`, and the current month's `list`) and
bundles their results. Each sub-handler re-derives `userId` from the request, so
their exact semantics carry through unchanged. Note `getDailySummary`
deliberately **does not** start a daily attempt — it resumes an already-open run
(`currentRun`) but never opens one, so a background boot/refresh can't silently
spend an attempt. When attempts remain and nothing is in progress the client
raises an explicit "Start attempt" overlay (`Game/Prestart.tsx`, the `prestart`
board phase) over an inert board; the button fires `startRun` — still the one
fetch-and-start call — and only that opens the attempt. Finishing a ranked
attempt re-raises the overlay for the next one (no auto-start) rather than
opening it. The pre-start overlay's blurred backdrop is the tutorial maze
(`IntroBoard`'s `initialBlocks`), deliberately **not** the day's puzzle, so it
can't leak the layout.

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
standings }` (`getBoard` + `standings`, same
composition as `dayView`). `primeBoot` then primes the three calls the deep-link
handler fires for that day — by-date `standings` (what `consumeDeepLink`
resolves the id with), then `getBoard` and `standings` **by iteration** (the id
is only known once boot lands, so those two primes are set in boot's `.then`).
Because the pool is content-keyed, the linked day's iteration-keyed calls never
collide with today's timezone-keyed primes — today's slices still feed the
dock/calendar/summary while the linked day feeds the staged board. An
unresolvable date (or a linked slice that can't be served) throws, so the
consumer falls through to its own fetch — the old skip-boot day-link path is
gone. `entryIsPastDayLink` (a `/YYYYMMDD` for a day _strictly before_ today)
gates today-**staging** so a linked past day wins the board (`useInit`). A link
to _today_ or a _future_ day is deliberately **not** suppressed: today has no
other day to stage, and a future day must not be staged at all (tomorrow's
iteration exists — the gen cron runs a day ahead — so staging it would leak the
puzzle you'll rank tomorrow; next week's 400s). Both fall through to today's
normal resume/prestart flow, and `consumeDeepLink` stages only for a
strictly-past link — so a today/future link lets `useInit` own the board.
(Gating on the raw day-link stranded a fresh user on a today/future permalink —
today's `getBoard` 403s until the three ranked attempts are spent, so nothing
staged _and_ the prestart was suppressed, leaving an inert loading board.)

**`dayView` is boot for one arbitrary day.** `routes/dayView.ts` composes
`getBoard` + `standings` for a chosen `{ iteration, timeZone }` — because a day
navigation (a calendar click, view-best) fires exactly those two: `getBoard`
from `showBoard`, and `standings` as the dock reacts to the iteration change.
`client/store/board.ts`'s `showDay(iteration)` fires the one `dayView`, then
`primeFrom` (the general form of `primeBoot`'s slicing — `client/api.ts`) primes
each slice under the exact input its consumer sends: `getBoard` under
`{ iteration, timeZone }`, and `standings` under `{ timeZone }` when the day is
today (the dock keys today by timezone) or `{ iteration }` for a past day — then
delegates to `showBoard`. Both methods are `RETRYABLE`, so a primed slice that
fails at transport falls through to a real fetch. `Calendar` (cross-day pick)
and `Profile` (view-best) call `showDay`; same-day re-stage, deep-links, and
gameplay stay on `showBoard`.

**Database (`server/db/`):** MariaDB, reached one of **two interchangeable
transports** selected once at boot (`db/query.ts`, `useDirect`):

- **proxy** (default) — HTTP to the SQL proxy at `w3x.io/sql`. Works from
  anywhere (Deno Deploy), needs no DB driver.
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
  This cron is the _bulk_ generator but **not the only writer**: Deno Deploy
  preview deployments don't run `Deno.cron`, so a dev/gappy env would otherwise
  hit "no daily available". `ensureDailyIterationId` (same file) backfills a
  missing day **on demand** in the daily read path (board/start/daily/standings,
  capped at tomorrow UTC so a future deep link can't leak a puzzle). That
  per-request path once raced the cron — two isolates both check-then-create a
  duplicate — but `iteration.created` is now a **UNIQUE `DATE`** (migration v14,
  the column narrowed from a timestamp since a puzzle is for a calendar day, not
  an instant), so the loser's INSERT is rejected instead of standing: **the DB
  is the mutex**, no app lock needed. `getIteration` returns that `DATE` as the
  board's `date`; the client needs no special parsing — a `DATE` deserialises to
  `YYYY-MM-DD` (or an ISO midnight-Z), both of which `new Date()` reads as UTC
  midnight, and the board caption formats it in UTC.
- `rate-dailies` (:30 hourly) — rates each daily once its date is closed across
  _all_ timezones (~37h after creation), writes ELO deltas (`util/rating.ts`,
  percentile-based), then fires "daily final" notifications and posts the day's
  results to Discord (`util/dailyAnnounce.ts` — the top ranked time and everyone
  tied for it, up to 10 names then a count; gold for a sole winner, chartreuse
  for a shared top).

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

**Flags** (`flag`, migration v15) are the one other player-owned row: the splits
tape's manual checkpoints. A flag belongs to the **board**, not to a run — one
row per `(user, iteration)` holding the whole set in a single column, the way a
run's maze is stored (`util/flags.ts`) — so every build of that maze is timed
against the same marks. They ride the `getBoard` response (and so `boot` /
`dayView` / every board loader through it) and are written back whole by
`setFlags`, an absolute-value upsert that is therefore idempotent and retryable.
Nothing but the owner reads them: they never touch timing, standings, or
validation.

Other invariants:

- **The run lifecycle splits by type, to keep request volume down and survive
  deploys.** A **ranked** attempt keeps the server bookends: `startRun` (stamps
  `ranked`, opens the authoritative 60s window) and per-build `updateRun`s — now
  **debounced** in `runSaver.ts` (a burst of placements collapses to one save).
  The debounce isn't fixed: `useInputEnd`'s `saveDebounce` ramps it from the 2s
  ceiling down to 0 over the final 10s, so a last-second edit is confirmed
  before the window closes rather than caught by it and reverted. The client
  also runs the ranked build clock `SAVE_GRACE_MS` (250ms) ahead of the server's
  true 60s (see `useInit`), so the execute-time flush lands inside the server
  window instead of arriving just past it (the last-second-edit-lost incident).
  **Free play** makes _no_ server round trips during the build: the client
  computes the path locally (`localRun`, the same engine the server runs),
  enforces the 60s window itself, mirrors the in-progress maze to `localStorage`
  (resume across reload — `freePlay.ts`), and touches the server exactly once,
  at execution, via `commitRun`. That commit is a single idempotent `INSERT`
  keyed by a client-generated `client_id` (migration v8), so it is
  **retryable**: a connection dropped by a deploy retries onto a fresh isolate
  and lands rather than losing the run. `commitRun` stays backwards compatible —
  a legacy cached client that still `startRun`+`updateRun`+bare-committed hits
  the old flip-void path (no `blocks`). Trusting the client on free play is
  deliberate: it's post-ranked, never feeds ELO, and the server still recomputes
  the time from the submitted maze — only the 60s budget is client-enforced.
- **Free play is ungated except for today's own daily.** Any past date is
  replayable at any time; the only board `getBoard` gates is _today's_ daily —
  it can't be free-played until its three ranked attempts are spent (no
  previewing/practising the puzzle you're about to rank). So a day that just
  rolled over is immediately replayable even while the new day's daily is still
  outstanding. A locked board answers a plain **`{ incomplete: true }` (200),
  never an error** — "not yet" is a state, not a fault, and it leaks nothing
  either way. It used to 403 unless the caller passed `soft`, which only `boot`
  did; every other path that legitimately lands on an unfinished today (the
  regrade refetch, a notification tap, `boot`'s own linked-day slice for a today
  permalink, a calendar pick while parked on a past day) therefore turned a
  routine "not yet" into a 403 — and since `client/api.ts` relays **every**
  error response to `reportClientError` from inside the proxy, before the caller
  can swallow it, each one logged a server-side error even where the call site
  was written to ignore it. Consumers already branch on `"incomplete" in r`
  (`store/board.ts`, `useInit`'s regrade); `showBoard` re-requests once on
  `{ incomplete }` so a stale prime (notably the linked-day slice a
  `/YYYYMMDD`-for-today boot stashes) can't wedge the first real stage. **Ranked
  play is a strictly local-day affair** — the client hard-cuts a ranked
  attempt's build window at the player's local midnight (an in-progress attempt
  executes early; no further attempts open on the old day), and surfaces the new
  day via an explicit switch (see the daily-rollover flow).
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
  notifications, push endpoints, board flags) as one JSON document the client
  offers as a download. `deleteAccount` (`routes/deleteAccount.ts` →
  `db/deleteAccount.ts`, `anonymizeUser`) is **anonymize-in-place, not a row
  delete**: it hard-deletes the caller's push subscriptions + notifications +
  flags (private annotations nothing else is computed from), then rotates
  `user.id` to a fresh random UUID and clears `name`/`settings`/`locale`. The
  runs ride along via `FK_run_user ON UPDATE CASCADE`, so the player's build
  history survives as one distinct **anonymous** competitor — the day's field,
  others' percentiles, and the applied ELO deltas aren't rewritten, and every
  `JOIN user` still resolves. The new id is never returned, so the link to the
  person is gone (anonymization, not pseudonymization). The op is an idempotent
  no-op on retry (the old id is gone), but `deleteAccount` is still **excluded
  from the client `RETRYABLE` allowlist** because on success the client mints a
  fresh local id + reloads, so a blind retry would act on the stale id. The
  confirm is gated behind typing "DELETE" (`DeleteAccount.tsx`).
  `public/privacy.html` is the static disclosure page linked from the same panel
  (the SQL proxy is first-party infra, not listed as a third-party recipient).

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
coalesce, failures retry with backoff), now **debounced** with a delay that
ramps from 2s down to 0 over the final 10s (`saveDebounce`). At run start
`flushRunSaver` **sends** the pending maze immediately (rather than reverting to
the last confirmed one — that would drop a debounced edit the player hasn't
waited out, e.g. tapping "Ready?" mid-build); if the window has already closed
the flush comes back expired and `onExpired` snaps the board back. **Free play**
bypasses the saver entirely: `freePlay.ts` mints the per-attempt `client_id`,
mirrors the maze to `localStorage` for reload-resume, and `commitRun` fires once
at execution; `useInit` awaits that commit before re-staging so a slow
(retrying) commit can't let the re-stage drop the run from recents. Picking a
maze to review RELEASES the runner over it (`viewMaze`'s `replay`, defaulting on
— asking to see a maze means asking to see it run; re-picking the row runs it
again), which is also why `runFinish` bails while `viewing`: a replay is not an
attempt finishing and must not commit, re-stage, or spend anything. The one
caller that opts out is the review a just-finished free-play run lands in, which
would replay the run you were already watching. A reviewed board stays inert to
placement, but a hover (or, on touch, a tap) still reveals a thunder's radius —
the day's pieces and the reviewed maze's alike, which is the point of studying a
maze. Navigating away mid-build (reviewing a maze, another day) deliberately
does NOT abandon the build — the record stays, and staging its board within the
window resumes it. A free-play run that FINISHES doesn't clear the board either:
the re-stage still runs (it refreshes the board's bests and recents), and the
executed maze is then overlaid back onto it as a review — the run you just
watched stays up, its row reads "viewing", and its splits are there to read.
Play stages a fresh board when you want one. Its window doesn't pause either:
reviewing a past maze keeps the live countdown in the HUD's Play slot alongside
the reset button, and reset there clears the attempt while staying on the
reviewed maze (the input hooks gate on `viewing`, so the ticking clock never
makes a reviewed board editable). Should the window expire mid-review, the board
hands back to the build (restored from the local record via `pendingFreePlay`,
the one read that ignores the deadline) and it executes normally — committed,
runner released. `useClock`/`RunClock` run the 60s/animation timing;
`verdict.ts` computes the result.

**Splits & flags (`Game/Splits.tsx`, `components/FlagLayer.tsx`,
`store/flags.ts`):** the tape above the runs list, rendered inside `.attempts`
so it scrolls with the list it describes. On desktop the dock and the runs are
one `.game__rail` spanning both grid rows — before that the dock sat in its own
row, whose height the (taller) today card in the left column set, leaving a wide
dead gap above the runs; the rail's `--rail-gap` is also the tape's bottom
margin, so the tape sits evenly between the two. It appears only for **a run in
free play** — one you're reviewing, or the one currently animating
(`(viewing || phase === "running") && !dailyInProgress`), so a run's splits are
readable while you watch it and its row is marked viewing from the moment it
executes. Mid-daily it would spoil the attempt being built, and a board with no
run has nothing to describe. Everything is computed locally: the maze on the
board and the reference (the best run in `viewedAttempts`) are each re-solved
with `localRun` and read through `computeSplits`, so the tape can never disagree
with the time on the row and costs no round trip. Viewing your own best hides
the delta column and shows absolute times — there is nothing to compare against;
otherwise each row is tinted by how it stands (`--split-tone`: green ahead, red
behind, amber dead level), the delta wearing it outright and the absolute time a
dimmed mix. The panel is a **fixed collapsed height** and holds that space even
when there is no tape to show (a `.splits--placeholder` on any free-play board),
so the runs below never hop as you move between a run, your best, and a live
board. Collapsed, every mark sits on one **wrapping** line; expanded, one row
per mark with the delta leading and the absolute time trailing, sliding open on
a `0fr -> 1fr` grid row (no measured height, and it degrades to a snap where
`fr` can't interpolate). While the runner is **animating**, the mark it is
running TOWARD is lit in both states — the split in progress, the way a speedrun
timer reads it, so the highlight moves the instant a mark is reached rather than
trailing a leg behind (past the last mark nothing is lit; there is no next one).
The runner's own colour, so it reads as "the runner is here" rather than joining
the gain/loss tones, and matched by time so marks sharing an instant (a flag on
the checkpoint) light together — the pill's width is padding every mark carries
lit or not, since the collapsed line wraps and appearing padding would reflow
it. `Runner` publishes its elapsed seconds to `runnerTime`
(`Game/interaction.ts`, alongside the pointer-frequency signals and for the same
reason: it is written every frame), and the tape reads it through a
`useComputed` that collapses it to the reached mark, so a re-render costs only
when the lit mark moves. Open/closed persists per player (`splitsOpen`). Its
caret is the standings dock's glyph in the dock's colour — one family for the
rail — but pointed differently on purpose: the dock opens a sheet (up, or left
into a desktop drawer), this discloses in place (right, rotating down). Flag
placement is explicitly **armed** from the footer (with the board visible a bare
tap is ambiguous — inspecting a thunder's radius vs. dropping a flag); armed,
the board dims behind a scrim, any cell takes a flag, and a flag drags to move /
taps to clear. The gesture mirrors a BLOCK placement, down to the placing zoom
and its delay: the flag appears under the pointer the instant it lands, follows
it, and is written on release — at the cell its preview stood on, never a fresh
mapping of the release point, since the zoom animation is still moving the
board's box under the finger (the same reason `useInputEnd` commits
`placingBlock` rather than re-reading the pointer). `store/flags.ts` folds flags
in from board responses, writes them back optimistically, and carries the two
board-facing signals (`liveFlags` — which flags this run actually crosses, the
rest drawing dashed as speculative — and `hoveredSplit`, the mark a hovered row
rings), the same signals-not-context split `Game/interaction.ts` uses.

**Push notifications:** `common/notifications.ts` is the shared, framework-free
domain (the five-way `classifyDailyOutcome`, and `notificationText` so push copy
and the in-app panel never drift). `notificationText` no longer hardcodes
English — it maps a stored notification's `kind` + `DailyVariant` to `notif.*`
catalog keys and renders through `t(...)` (see Localization below), so push and
in-app copy localize from one source. In-app notifications are always written;
push delivery is opt-in per kind (`common/settings.ts`) and needs VAPID keys
set. `public/sw.js` is the service worker.

**Discord results webhook (`util/discordResults.ts`):** a player-facing channel
mirror, separate from `adminAlert`'s operator pings. Two posts, both rich embeds
in the game's gold/chartreuse palette (`SUPREME_COLOR`/`PEAK_COLOR`) with a
title link to the day's `/YYYYMMDD?board=` permalink:

- **Top PB** — a message tracking the day's current record on the PB
  (best-build) board. A **new holder taking the top** posts a fresh (gold)
  message: a build passing the previous top holder (`decideLostTop` — the exact
  event that sets a **lost-top notification**), or the day's **first PB** (the
  sole player bettering their own best, no one to pass). Each fresh post first
  greys out (`GREY`) the message it supersedes, reconstructed from the marker,
  so the channel highlights only the current record. A build **matching the
  announced top** _edits_ the message with the tie count (chartreuse — "N
  players have matched it"). The **same holder improving their own lead**
  _edits_ within a 12h window (`PB_EDIT_WINDOW_MS`), and posts a fresh message
  past it **or** once the record has been matched in between (breaking a shared
  record is its own event — the supreme→matched→retake-supreme case).
  Non-topping builds and replays that don't take the top do nothing — so
  replaying an old board can't resurface its record. The state is a **`pb_top`
  marker** (one row per iteration: the announced holder, message id, time, tie
  count, and post time — migrations v11–v13): `top_user` dedups a burst of
  leading saves and distinguishes a lead change; `holders` drives the tie edit
  and the break-the-seal repost; the message id + `announced_at` drive the
  edit-vs-repost window. `topPbToAnnounce` (replay-safe new-sole-top detection)
  and `decidePbAction` (post/edit/none) are pure and unit-tested; `onPbBuild`
  (`util/pbBoard.ts`) is the one hook the run write path calls whenever a build
  enters the PB field (free-play `commitRun`, or a ranked `updateRun` that
  reaches the field top), and it drives both the post and the lost-top
  notifications off the same load of the day's bests.
- **Daily final** — posted by the `rate-dailies` cron once a day is rated (see
  the cron list), listing the ranked winners.

Both are best-effort (never throw, awaited so this Deploy doesn't kill them mid
flight) and no-op without a webhook configured. See the `DISCORD_*` env vars.

## Localization (i18n)

User-facing copy lives in **ICU MessageFormat catalogs** under `i18n/`, not
inline in code. `i18n/en.json` is the source of truth
(`{ key: { message,
description } }`); it defines the key set and, through the
ICU args, the params each message takes. `scripts/genI18n.ts` (the `i18n` task,
run first in `build`/`dev`/`test` and in CI before `deno check`) compiles every
`i18n/<locale>.json` into **`common/i18n.generated.ts`** — gitignored and
generated exactly like `common/version.ts`. The generated module pre-parses each
message to an `I18nNode[]` AST (so **no ICU parser ships in the client bundle**
— the parser is `scripts/i18nParse.ts`, build-only) and derives `MessageKey` + a
per-key `MessageParams` type map from `en.json`, so a missing key or wrong
argument at a `t(...)` call site is a **compile error** (the `BlocktolApi`
type-derivation move).

`common/i18n.ts` is the one runtime, pure and framework-free so server and
client share it: `t(locale, key, params)` resolves the BCP-47 `locale` to a
supported catalog locale (exact tag → language prefix → `en`; the full tag still
drives `Intl` number/plural formatting) and walks the AST — `{arg}`
substitution, `{count, plural, …}` via `Intl.PluralRules` with `#`,
`{sel, select, …}`. `locale` is omitted on the client (viewer's own locale) and
set to the recipient's `user.locale` for server-rendered push copy — the same
convention `common/format.ts` already uses. A locale missing a key falls back to
the English AST. **Conventions:** keys are stable and namespaced by surface
(`notif.`, …), never encode the English text; **never interpolate a key** — map
an enum to its key with a literal object/ternary so every live key is greppable
(see `notificationText`). Rich-text copy — a message that wraps part of the
sentence in markup (a `<b>`, a link) — uses `tJsx` (`client/util/t.ts`), which
returns a `(string | VNode)[]` instead of a string: the catalog keeps one arg
per wrapped span (`"You beat {pct} of players today"` with `pct={<b>84%</b>}`)
so a locale can move the emphasis where its grammar wants; plain `t` covers
everything else. **User-facing piece names are `block` and `thunder`** — the
internal `bricks`/`power`/`slow` names never appear in copy (see
`i18n/glossary.json`, which the translator reads).

Adding/altering copy: edit `i18n/en.json`, run `deno task i18n` (or any
`build`/`dev`/`test`), and call `t(...)`. Remaining migration work is tracked in
`docs/localization.md`.

**Picking the language.** `settings.language` (`common/settings.ts`) holds the
choice — `"system"` (the default) or a BCP-47 tag; the tolerant parser keeps any
string (the catalog resolves an unsupported tag to English). `applyLanguage`
(`client/hooks/useSettings.ts`, run at `initSettings` boot and on every settings
change, mirroring `applyTheme`) points the `uiLocale` signal at the tag —
`"system"` resolves to `navigator.language`, so **an un-overridden user gets
their browser language**, falling back to English — and stamps
`document.documentElement.lang` with the resolved catalog locale. Because every
`t(...)` reads `uiLocale`, a switch re-renders live. The Profile → Preferences
picker is a native `<select>` of `locales` (endonyms via `Intl.DisplayNames`)
plus a System option. An **explicit** choice also rides to the server
(`setSettings` → `updateUserLocale`) so push copy — rendered in `user.locale` —
matches; `"system"` leaves `user.locale` as the browser tag captured passively
at push-subscribe, so the two stay in step.

## Environment variables

`PORT` (local only; the platform manages it in prod), `APP_ENV` (`dev`/`prod` —
selects the proxy database `blocktol-<env>`), `SQL_PASSWORD`, `SQL_PROXY_URL`
(the SQL proxy endpoint; defaults to `https://w3x.io/sql` — set to the proxy's
localhost address when the server is co-located with it, e.g. the EC2 cohost, to
drop the internet round-trip), `SQL_TRANSPORT` (`direct` selects the direct
MariaDB connector over the proxy — for the co-located instance; anything else,
including unset, stays on the proxy) with `SQL_HOST` (default `127.0.0.1`),
`SQL_PORT` (`3306`), `SQL_USER`/`SQL_DATABASE` (both default `blocktol-<env>`)
configuring that connector (it reuses `SQL_PASSWORD`), `DISABLE_CRONS` (any
non-empty value skips registering the `ensure-iterations`/`rate-dailies` crons —
for a second instance on the shared DB),
`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (Web Push; generate with
`deno run scripts/genVapidKeys.ts`; until set, notifications stay in-app), and
`DISCORD_ADMIN_WEBHOOK_URL` (a Discord webhook URL for fire-and-forget operator
alerts via `util/adminAlert.ts` — plain REST, no bot token / discord.js; unset =
alerts are no-ops), and `DISCORD_RESULTS_WEBHOOK_URL` (the player-facing results
webhook — the "top PB" and "daily final" posts via `util/discordResults.ts`;
falls back to `DISCORD_ADMIN_WEBHOOK_URL` when unset, so results land in the
operator channel until a dedicated one is wired up, and both being unset makes
the posts no-ops). The task definitions enumerate the exact `--allow-env`
grants.

**Observability (OpenTelemetry).** Blocktol uses Deno's **built-in** OTel
(`OTEL_DENO=true`), which auto-instruments `Deno.serve` requests, outbound
`fetch` (the SQL proxy hop), and crons — so tracing is **env-configured, not
code**: there is no OTel SDK wiring in the source, and these vars are read by
the runtime's telemetry subsystem, **not** user code, so they need no
`--allow-env` grant (and `start`/`dev` already use bare `--allow-net`).
Telemetry is enabled **only on the co-located blocktol.com instance** — the one
running on the w3x.io box alongside VictoriaTraces + VictoriaLogs; the Deno
Deploy instance is deliberately left un-instrumented. VictoriaLogs v1.51.0
(`127.0.0.1:9428`) and VictoriaTraces v0.9.4 (`127.0.0.1:10428`) run as systemd
services, **bound to localhost only**, data under `/data`, 30-day retention —
first-party infra (same box as the SQL proxy, not a third-party recipient), so
ingest is a pure loopback call with **no auth**. blocktol emits **both** traces
and logs through Deno's built-in OTel straight to those endpoints; the env lives
in the systemd `EnvironmentFile` at `/home/ubuntu/blocktol/.env`
(`OTEL_DENO=true`, `OTEL_SERVICE_NAME=blocktol`, `OTEL_METRICS_EXPORTER=none` —
neither backend ingests metrics, `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`,
and per-signal endpoints). The per-signal endpoints are required because
VictoriaTraces/Logs use non-standard ingest paths and Deno otherwise appends the
standard `/v1/*`:
`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://127.0.0.1:10428/insert/opentelemetry/v1/traces`,
`OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://127.0.0.1:9428/insert/opentelemetry/v1/logs`.

The box also runs **Vector** (a journald→VictoriaLogs shipper) for its _other_
services (`w3xio`, `dw3xio`, `katma`, `st2mr`, `emojist`) — but blocktol is
**deliberately excluded** from Vector: Deno OTel already ships blocktol's logs,
so listing it there would double-ingest every line. Don't re-add it. The VL/VT
UIs are localhost-only (no public endpoint); view them over an SSH tunnel to the
ports — `localhost:9428/select/vmui/` and `localhost:10428/select/vmui/`. (A
`victoria.w3x.io` DNS record exists but is currently parked/unused — there is no
authed public ingest or viewing endpoint.)

This self-hosted pipeline is the only error sink; there's no separate error
service. A thrown handler exception is `console.error`'d (→ VictoriaLogs,
trace-correlated by `trace_id`) and `recordException`'d onto the request span (→
VictoriaTraces); a handler that returns a 5xx without throwing is `log.error`'d,
and the 500 response marks its span errored; a relayed client crash
(`reportClientError`) is `log.error`'d the same way. `endLogger` also returns
the request span's trace id on every response as `x-blocktol-trace-id` (skipped
when tracing is off — the Deno Deploy instance reports the all-zero id), so a
response can be pasted straight into VictoriaTraces to pull its trace, and its
logs via the shared `trace_id`.

`util/logging.ts` emits **logfmt** — one line of flat `key=value` pairs
(`level=info msg=request method=POST status=200 route=/api/boot ms=13 userHash=…`)
— so VictoriaLogs surfaces `status`/`route`/`userHash`/… as queryable fields via
a `| unpack_logfmt _msg` at query time (nothing extracts them at ingest — Deno's
OTel delivers the console line as the `_msg` body). The API is
`log.<level>(msg, fields?)` or `log.<level>(req, msg, fields?)` (the `req` form
folds in the request context), and **`fields` is flat by type** — nested
objects/arrays don't compile, forcing a caller to flatten (logfmt can't
represent nesting and VL can't query what it can't see as a field). Two escape
hatches in the same module: `errText(err)` renders a caught value to one field
(an Error's stack, else stringified — use it as `{ error: errText(err) }`), and
`coerceFlat(record)` flattens an `unknown`-typed record (client error payloads)
by stringifying any non-primitive value. No timestamp in the payload — Deno's
OTel stamps `_time`; a second would duplicate it. `level=` also gives Grafana a
field to colour rows by.

**Build SHA / stale-client reload.** `common/version.ts` (`export const SHA`) is
generated at build time by `scripts/genVersion.ts` — the `version` task, which
`build`/`dev` run first; it's **gitignored** (a build artifact like
`public/js`), so `deno task start` requires a prior build (CI generates it
before `deno check`/`build`). Because it lives in pure `common/`, the server
imports the _same_ constant the client bundles, so the two SHAs are
byte-identical by construction — no `GIT_SHA` env plumbing, no short-vs-full
mismatch. `genVersion` prefers a `GIT_SHA` env, else
`git rev-parse --short HEAD`, else `"dev"` (which no-ops the comparison). Every
request logs `serverSha` (this process's build) and `clientSha` (the caller's
bundle, sent as the `x-blocktol-client-sha` header) on the start line, so
version skew is queryable. `endLogger` stamps `x-blocktol-server-sha` on
responses; the client reads it (`api.ts` → `store/version.ts`) and, when the
server's build is newer than its own bundle, flips a sticky `staleClient`
signal. `useVersionRefresh` (wired in `App`) then `location.reload()`s to pick
up the fresh assets — but **never mid-attempt** (deferred while the board phase
is `building`/`running`; the sticky flag reloads once the attempt ends).

The user id rides telemetry only as a **hashed** tag (`userHash` in the request
log, `user.hash` on the request span), via `util/hashUserId.ts` (a truncated
SHA-256) — set in `middleware/userid.ts`, also used by the cap-hit warn. Never
the raw `authorization` credential: the raw id is the bearer token, and
logs/traces flow to VictoriaLogs/VictoriaTraces, which are readable without it.
The rule for any user-id tagging is the same everywhere: **hashed only, never
the raw credential.** (The one deliberate exception is the low-volume Discord
operator alert in `db/user.ts`, which keeps the raw id so an operator can look
the player up in the DB.)

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
