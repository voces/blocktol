# server/ — architecture

Loaded when working under `server/`. The root `CLAUDE.md` covers the whole repo:
what the game is, commands, the import rule, and the domain invariants every
area relies on.

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
restart gap.) With `PORT` set it listens on **127.0.0.1 only**, so nginx is the
one way in. On SIGTERM (every deploy's restart) it stops cleanly: in-flight
requests finish and any running cron completes (`util/shutdown.ts`; capped at
~65s, under the unit's `TimeoutStopSec`), and no new cron starts. Killing
`rate-dailies` between claiming a day and announcing it would lose that day's
notifications for good.

**Router (`server/util/Router.ts` + `server/router.ts`):** a small Express-like
middleware chain over `URLPattern`. Path params are type-derived from the route
string. `HEAD` is answered as `GET` without the body (`index.ts`); the router
itself registers only `GET`. Every request flows: `beginLogger` → login-link
routes → `GET /health` (the uptime monitor's probe: one query for today's
puzzle, so 200 means app, database and generation all work; 503 says which
failed; `routes/health.ts`) → `extractUserId` → **`POST /api/:method`** → the
`/YYYYMMDD` day-permalink (serves the SPA shell) → `/privacy.html` (rendered per
language — see _Data rights_ in the root `CLAUDE.md`) → `staticServe` →
`endLogger`. A thrown `UserError` becomes a 400 (its `NotFoundError` subclass —
e.g. an unknown iteration id — a 404); anything else is a 500 — logged
(`console.error` → VictoriaLogs) and recorded on the request span
(`recordException` → VictoriaTraces). Every response — the router's own
fallbacks included — leaves through `withSecurityHeaders`
(`middleware/securityHeaders.ts`, applied in `index.ts`): nosniff,
`Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, HSTS, and a
deliberately minimal CSP (`frame-ancestors`/`base-uri`/`object-src` only — a
full policy needs a browser pass over the app, SW, debug and privacy pages
first).

**The API is one endpoint.** `server/routes/api.ts` owns a `handlers` registry;
`POST /api/:method` looks the method up (own keys only — `/api/constructor` is a
404), reads the body under a 64 KiB cap (`MAX_BODY_BYTES`, ~5× a full 400-piece
commit; over it is a 413), zod-validates it against `handler.validation`, calls
`handler.handler`, and JSON-encodes the result. The exported `BlocktolApi` type
is _derived from the registry_ and is the only thing the client imports — add a
route by adding a `{ validation, handler }` (see `routes/apiHelpers.ts`'s
`method(...)` helper) to that object and the client's typed `api.<method>()`
appears automatically. A handler returning `{ status: >=500 }` (or throwing) is
reported; 4xx are treated as expected client faults.

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
(`IntroBoard`'s `decoBlocks`, drawn by `Game/Prestart.tsx`), deliberately
**not** the day's puzzle, so it can't leak the layout.

The client's `primeBoot` (`client/api.ts`) fires it once and primes each method
with its slice, so every call site consumes off the single fetch and a cold load
is one round trip (the boot standings double-fire is separately guarded by a
freshness check in `store/standings.ts`). The prime is **content-addressed**
(method + serialized input), which is what lets a parameterized method be
bundled: the calendar's two mount months (`list` returns `[current, prev]`) are
each keyed by their month range, so both month fetches consume off boot (boot
derives the two months from the caller's timezone to match
`dailyItems.monthListInput`). `primeBoot` also seeds `todayIteration` from
boot's standings slice so the dock recognizes the staged board as today and
consumes the primed `standings` rather than refetching by id. On a boot failure
each slice rejects and the consumer falls through to its own fetch. Every prime
(boot's and `primeFrom`'s) expires 10s after its response arrives
(`util/primePool.ts`), so one its consumer never took — the dock answering a
re-opened day from its own cache — can't be served minutes later as a stale
snapshot; a late consumer just fetches.

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
consumer falls through to its own fetch. `stagingPastDayLink()` (a `/YYYYMMDD`
for a day _strictly before_ today) gates today-**staging** so a linked past day
wins the board (`useInit`) — until that link fails to resolve or stage (a bad
date, a transient failure), which drops the gate and re-asks `getDailySummary`,
handing the board back to today's resume/prestart rather than an inert loading
board. A link to _today_ or a _future_ day is deliberately **not** suppressed:
today has no other day to stage, and a future day must not be staged at all
(tomorrow's iteration exists — the gen cron runs a day ahead — so staging it
would leak the puzzle you'll rank tomorrow; next week's 400s). Both fall through
to today's normal resume/prestart flow, and `consumeDeepLink` stages only for a
strictly-past link — so a today/future link lets `useInit` own the board.
(Gating on any day-link would strand a fresh user on a today/future permalink:
nothing staged, since today's board is locked until the three ranked attempts
are spent, and the prestart suppressed.)

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
  capped at tomorrow UTC so a future deep link can't leak a puzzle, and floored
  at the earliest existing iteration — or yesterday UTC on an empty table — so a
  script walking dates backwards can't mass-generate boards and starve
  `rate-dailies`; see `util/backfillWindow.ts`; the cron calls `newIteration`
  directly, so neither bound applies to it). The cron and a request can race
  (each check-then-create), so `iteration.created` is a **UNIQUE `DATE`**
  (migration v14 — a puzzle is for a calendar day, not an instant) and the
  loser's INSERT is rejected: **the DB is the mutex**, no app lock needed.
  `getIteration` returns that `DATE` as the board's `date`; the client needs no
  special parsing — a `DATE` deserialises to `YYYY-MM-DD` (or an ISO
  midnight-Z), both of which `new Date()` reads as UTC midnight, and the board
  caption formats it in UTC. The iteration row and its fixed blocks are inserted
  in one transaction (`createIteration`), so a dropped connection can't leave a
  day with no pieces. Each run also ends with the **rate-dailies watchdog**
  (`checkRatingLiveness`): a closed day still unrated 6h past its close means
  rating has stopped, and it `alertAdmin`s (once per run) — run from this cron
  so a dead `rate-dailies` is still noticed. It then runs the **retention
  sweep** (`util/retention.ts` → `db/retention.ts`): notifications older than 90
  days, and `user` rows over 30 days old that hold nothing (no runs, push
  subscriptions, settings, locale, `pb_top` mention, or chosen name — one-off
  visitors and crawlers). Both delete in bounded `LIMIT` batches, so a backlog
  drains over several runs inside the 3s timeout. There is no last-seen column,
  so age is `created`; a pruned device that boots again just gets a fresh row.
- `rate-dailies` (:30 hourly) — rates each daily once its date is closed across
  _all_ timezones (~37h after creation), writes ELO deltas (`util/rating.ts`,
  percentile-based), then fires "daily final" notifications and posts the day's
  results to Discord (`util/dailyAnnounce.ts` — the top ranked time and everyone
  tied for it, up to 10 names then a count; gold for a sole winner, chartreuse
  for a shared top), then a **second, separate message** carrying the day's
  **top build** — the best-build board's top time, whoever reached it first and
  everyone who matched them (`dayTopBuild` → the shared `pbEmbed`). Rating flips
  `rated` before announcing, so these posts are also what unblocks that day's
  live top-PB posts — and that second message IS the day's standing top-PB post
  (it writes the `pb_top` marker), so a later free-play record supersedes it
  rather than standing beside it. Rating **claims** the day atomically
  (`applyRatings`: `rated = FALSE → TRUE` and the ELO deltas in one transaction,
  deltas gated on the claim), and only the claiming writer notifies/announces —
  so a second cron writer on the same DB (a forgotten `DISABLE_CRONS`) costs
  duplicate work, never a doubled rating or post. Deltas are applied relative to
  the stored rating by an UPDATE of existing rows only, so a user merged or
  erased mid-sweep is never re-created under their old id.

## Push notifications

`common/notifications.ts` is the shared, framework-free domain (the five-way
`classifyDailyOutcome`, and `notificationText` so push copy and the in-app panel
never drift). `notificationText` maps a stored notification's `kind` +
`DailyVariant` to `notif.*` catalog keys and renders through `t(...)` (see
`i18n/CLAUDE.md`), so push and in-app copy localize from one source. In-app
notifications are always written; push delivery is opt-in per kind
(`common/settings.ts`) and needs VAPID keys set. `public/sw.js` is the service
worker.

**A push subscription dies quietly, so three things keep it alive.** The
per-kind toggles are stored SETTINGS that gate the server's send decision — they
say nothing about whether a device can still receive, so "toggled on but nothing
arrives" is the typical symptom.

- **Rotation.** The browser retires subscriptions on its own (Chrome on Android
  after a Play Services re-registration, a browser update, a long idle stretch,
  or a `userVisibleOnly` budget revocation) and signals it with
  `pushsubscriptionchange`. The SW handles it: it re-subscribes and re-registers
  against the server there and then. It can't reach `localStorage` for the
  device credential and there's no page open to ask, so `client/util/push.ts`
  mirrors the id into **Cache Storage** (`blocktol-cred`, kept in the SW's
  `activate` keep-set) — two same-origin stores, no new exposure. The VAPID
  public key is likewise **injected into `sw.js`** by `util/assets.ts`, beside
  the asset manifest, since `/api/pushConfig` isn't reachable without a page.
  Otherwise the only recovery is the next app open, and a daily-final push is
  often what prompts one, so the failure sustains itself.
- **Key rotation.** A subscription minted under a retired VAPID key is
  permanently undeliverable: the push service answers **403**, which is _not_
  the 404/410 the fan-out prunes on, so the row survives forever and the client
  cheerfully re-registers the same dead endpoint every boot. `subscribePush`
  compares the existing subscription's `applicationServerKey` against the
  server's current one (`keyMatches`) and replaces it on a mismatch, dropping
  the stale row server-side too. The send path deliberately **does not prune on
  403** — unlike a 410 it's equally consistent with a misconfigured key pair,
  and pruning would delete every subscription in one sweep; it logs
  `push send rejected (vapid key)` instead.
- **Honesty in the UI.** `pushState` (`client/util/push.ts`) carries what this
  device can actually do — `ok` / `prompt` / `denied` / `unavailable` — and
  Profile renders it above the toggles, so a blocked permission or a browser
  without push says so instead of showing a switch that reads "on" and means
  nothing. It reflects what the BROWSER reports; an OS-level block the browser
  doesn't mirror (a revoked Android `POST_NOTIFICATIONS` grant) still reads as
  `ok`.

The endpoint is client-supplied and the server POSTs to it, so `subscribePush`
accepts only `isPushEndpoint` (`util/webpush.ts`): https on the default port to
an allowlisted browser push service (FCM, Mozilla autopush, WNS, Apple) — never
an arbitrary url (SSRF into the box's loopback services). A user keeps at most
`MAX_SUBSCRIPTIONS_PER_USER` (10) rows; the upsert bumps `created` (so it reads
"last registered") and prunes the stalest past the cap. A pre-allowlist row that
fails the check is skipped at send (logged once per host,
`push endpoint refused`), not pruned. `unsubscribePush` deletes only the
caller's own row.

**Reading the push path in VictoriaLogs.** A successful send logs **nothing**,
so an empty result for `"push send"` means "nothing failed", NOT "nothing was
sent" — and telemetry only runs on the EC2 instance (the Deno Deploy dev
previews log nothing either way). The positive signals are the two fan-out
summaries, `daily-final notifications` and `lost-top notification` (both carry a
`pushes` count; `pushes=0` is "opted in, but no live subscription"), and
`push subscription pruned` — the one line a dying row emits — a 410 prune is
exactly how a device goes quiet. Failures are `push send failed` (its `reason`
is the push service's own explanation), `push send rejected (vapid
key)` (a
rotated key — see above), `push send error`, and `push fan-out error`. Nothing
is extracted at ingest, so filter on raw text first and unpack after:
`_time:30d "daily-final notifications" | unpack_logfmt | fields _time, iteration, inApp, pushes`.

## Discord results

**Discord results webhook (`util/discordResults.ts`):** a player-facing channel
mirror, separate from `adminAlert`'s operator pings. Three posts, all rich
embeds in the game's gold/chartreuse palette (`SUPREME_COLOR`/`PEAK_COLOR`) with
a title link to the day's `/YYYYMMDD?board=` permalink:

- **Top PB** — a message tracking the day's current record on the PB
  (best-build) board, and **only on a day that is already `rated`**. While the
  daily is live, a "new top build" in the channel is a heads-up on the ceiling
  for everyone still holding ranked attempts, so `onPbBuild` skips the post
  outright until the day is finalized; the day's records surface instead in the
  rating sweep's top-build post (below). The **in-app** lost-top notification is
  deliberately unaffected — it's addressed to one player, about their own
  record, on a surface they only reach after their attempts. Everything below
  therefore describes a rated day (a later free-play record on a closed board
  leaks nothing). A **new holder taking the top** posts a fresh (gold) message:
  a build passing the previous top holder (`decideLostTop` — the exact event
  that sets a **lost-top notification**), or the day's **first PB** (the sole
  player bettering their own best, no one to pass). Each fresh post first greys
  out (`GREY`) the message it supersedes, reconstructed from the marker, so the
  channel highlights only the current record. A build **matching the announced
  top** _edits_ the message (chartreuse), which **names** the matchers — up to
  `MAX_NAMES`, then a bare count; the grey-out path falls back to the count
  because the marker stores only how many shared the top, which is all a
  superseded message needs. The **same holder improving their own lead** _edits_
  within a 12h window (`PB_EDIT_WINDOW_MS`), and posts a fresh message past it
  **or** once the record has been matched in between (breaking a shared record
  is its own event — the supreme→matched→retake-supreme case). Non-topping
  builds and replays that don't take the top do nothing — so replaying an old
  board can't resurface its record. The state is a **`pb_top` marker** (one row
  per iteration: the announced holder, message id, time, tie count, and post
  time — migrations v11–v13): `top_user` dedups a burst of leading saves and
  distinguishes a lead change; `holders` drives the tie edit and the
  break-the-seal repost; the message id + `announced_at` drive the
  edit-vs-repost window. `topPbToAnnounce` (replay-safe new-sole-top detection)
  and `decidePbAction` (post/edit/none) are pure and unit-tested; `onPbBuild`
  (`util/pbBoard.ts`) is the one hook the run write path calls whenever a build
  enters the PB field (free-play `commitRun`, or a ranked `updateRun` that
  reaches the field top), and it drives both the post and the lost-top
  notifications off the same load of the day's bests.
- **Daily final** — posted by the `rate-dailies` cron once a day is rated (see
  the cron list), listing the ranked winners and nothing else. Links
  `?board=daily`.
- **Top build** — a SECOND message from the same sweep, sent straight after the
  summary: the day's record on the best-build board, rendered by the **same
  `pbEmbed`** as the live top-PB post above, because it is the same fact. The
  sweep writes the `pb_top` marker from it, which is what lets the live path
  edit or supersede this very message for the rest of the day instead of opening
  a second lit record post. `dayTopBuild` returns `null` — and nothing is sent —
  when the ranked winners ARE the top build and nobody joined them, since the
  summary already said that; equal tops mean every winner is necessarily a
  holder (a ranked run is a build like any other in `getIterationBests`), so an
  equal COUNT is the whole of the duplicate case. It stays a separate
  **message**, not an addendum inside the summary nor a second embed on the same
  post, so it can be **moderated independently**: it carries its own message id,
  so deleting or editing it away leaves the day's ranked result standing.

  Its subject is the best build of the day, measured on the best-build board:
  not who beat the ranked winner, and the winner is never excluded for winning.

Both are best-effort (never throw, awaited so they finish before the request
does, each fetch bounded by a timeout) and no-op without a webhook configured.
Player-written text never reaches Discord raw: names go through `escapeDiscord`
(`util/discordText.ts` — markdown metacharacters escaped, `://` broken so a name
can't be a masked or bare link, newlines flattened) inside `pbEmbed` /
`dailyEmbed`, an id quoted in an admin alert through `discordCode`, and both
webhooks send `allowed_mentions: { parse: [] }`. See the `DISCORD_*` env vars.

## Environment variables

`PORT` (set locally and on the EC2 instance, where nginx proxies to it; a Deno
Deploy preview manages its own), `APP_ENV` (`dev`/`prod` — selects the proxy
database `blocktol-<env>`), `SQL_PASSWORD`, `SQL_PROXY_URL` (the SQL proxy
endpoint; defaults to `https://w3x.io/sql` — set to the proxy's localhost
address when the server is co-located with it, e.g. the EC2 cohost, to drop the
internet round-trip), `SQL_TRANSPORT` (`direct` selects the direct MariaDB
connector over the proxy — for the co-located instance; anything else, including
unset, stays on the proxy) with `SQL_HOST` (default `127.0.0.1`), `SQL_PORT`
(`3306`), `SQL_USER`/`SQL_DATABASE` (both default `blocktol-<env>`) configuring
that connector (it reuses `SQL_PASSWORD`), `DISABLE_CRONS` (any non-empty value
skips registering the `ensure-iterations`/`rate-dailies` crons — for a second
instance on the shared DB),
`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` (Web Push; generate with
`deno run scripts/genVapidKeys.ts`; until set, notifications stay in-app —
**silently**, and this has bitten prod once: with no key `/api/pushConfig`
answers `{publicKey:null}`, clients can't subscribe, and the notify paths return
before attempting a send, so nothing at all reaches the logs while the player's
preference toggles still read "on". `curl -X POST <host>/api/pushConfig -d '{}'`
is the check. Carrying the env across a host migration is the failure mode —
existing `push_subscription` rows survive it untouched, since nothing ever sends
and so nothing ever prunes. Restore the ORIGINAL pair where possible: new keys
invalidate every live subscription with a 403, which is not pruned), and
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
Telemetry is enabled **only on the EC2 instance** (blocktol.com, on the w3x.io
box alongside VictoriaTraces + VictoriaLogs); the Deno Deploy dev previews are
un-instrumented. VictoriaLogs v1.51.0 (`127.0.0.1:9428`) and VictoriaTraces
v0.9.4 (`127.0.0.1:10428`) run as systemd services, **bound to localhost only**,
data under `/data`, 30-day retention — first-party infra (same box as the SQL
proxy, not a third-party recipient), so ingest is a pure loopback call with **no
auth**. blocktol emits **both** traces and logs through Deno's built-in OTel
straight to those endpoints; the env lives in the systemd `EnvironmentFile` at
`/home/ubuntu/blocktol/.env` (`OTEL_DENO=true`, `OTEL_SERVICE_NAME=blocktol`,
`OTEL_METRICS_EXPORTER=none` — neither backend ingests metrics,
`OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`, and per-signal endpoints). The
per-signal endpoints are required because VictoriaTraces/Logs use non-standard
ingest paths and Deno otherwise appends the standard `/v1/*`:
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
when tracing is off — a Deno Deploy preview reports the all-zero id), so a
response can be pasted straight into VictoriaTraces to pull its trace, and its
logs via the shared `trace_id`. On the EC2 box that id is nginx's: the same
value is the `trace=` on the request's line in
`/var/log/nginx/blocktol.access.log` (`deploy/blocktol-trace.conf`).

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
by stringifying any non-primitive value. Keys are reduced to `[A-Za-z0-9_.-]` on
output, and `reportClientError` namespaces its payload as `client.<key>` (≤20
keys, values cut to 4000 chars), so a client can neither forge fields nor
override request context like `userHash` — its stack is `client.error`. No
timestamp in the payload — Deno's OTel stamps `_time`; a second would duplicate
it. `level=` also gives Grafana a field to colour rows by.

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
server's build differs from its own bundle, sets a sticky `staleServerSha`
signal. `useVersionRefresh` (wired in `App`) then `location.reload()`s to pick
up the fresh assets — but **never mid-attempt** (deferred while the board phase
is `building`/`running`; the sticky flag reloads once the attempt ends), and
**at most once per server build** (`claimReloadFor`, a marker in storage; no
auto-reload where storage is blocked). Mid in-place deploy the outgoing process
can answer a client already holding the new bundle, which no reload fixes, so an
unguarded reload loops. The same window can poison caches: the old process
stamps its old `?v` while disk holds the new files. So `sw.js` caches a
versioned asset only if its bytes hash to its `?v` (the server's `shortHash`,
mirrored), and `staticServe` marks an asset immutable only while its file's
mtime is the one this process hashed.

The user id rides telemetry only as a **hashed** tag (`userHash` in the request
log, `user.hash` on the request span), via `util/hashUserId.ts` (a truncated
SHA-256) — set in `middleware/userid.ts`, also used by the cap-hit warn. Never
the raw `authorization` credential: the raw id is the bearer token, and
logs/traces flow to VictoriaLogs/VictoriaTraces, which are readable without it.
The rule for any user-id tagging is the same everywhere: **hashed only, never
the raw credential.** (The one deliberate exception is the low-volume Discord
operator alert in `db/user.ts`, which keeps the raw id so an operator can look
the player up in the DB.)
