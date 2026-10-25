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

## ⚠️ A deploy migrates

There is no step between a deploy and a database: every deploy boots the server,
and boot applies every pending migration. Nobody runs one by hand; "please run
migration vN on dev" is never a step.

- **Merging to `prod`** deploys both instances on the EC2 box: prod
  (`deploy.yml`) against the **production** database, and the dev instance
  (`deploy-dev.yml`, which follows `prod`'s tip) against `blocktol-dev`.
- **Approving a PR's waiting Deploy dev job** puts that PR's head on the dev
  instance and applies its migrations to `blocktol-dev`, before review ends.
  Approval takes a person (the `dev` environment's required reviewer); an agent
  asks for it rather than assuming its branch reached dev.
- **Pushing a branch** deploys nothing and migrates nothing.

A migration that reached dev stays applied there even if its PR is later
dropped. Before asking for a deploy that carries one: make sure its version
number isn't also taken by another open PR (two PRs' v17s collide on dev), and
that it is safe to run against real data. Don't deploy a migration just to try
it out. See `server/db/CLAUDE.md` and `deploy/README.md` "Dev instance".

## Commands

Everything is a Deno task (`deno.jsonc`). Deno v2.x; no `package.json`, no
bundler config.

```bash
deno task dev        # bundle (watch) + run server (watch) — local dev
deno task start      # run the server once (prod-style)
deno task build      # bundle + minify client -> public/js/{index.js,pathing.js}; map -> sourcemaps/<SHA>/
deno task symbolicate <clientSha> < stack.txt   # minified client stack -> source positions
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

Tests use `test` from `node:test` (subtests are `t.test`), never `Deno.test`:
`deno test` runs them today and Node will after the runtime move (#226).
`node:test` has no leak check, so a test closes every timer, connection and
stream it opens. Most tests are pure and need no permissions. The `*.test.ts`
under `server/routes/iteration/run/` and a few others are **run-lifecycle
integration tests** that hit the dev database through the SQL proxy; they
self-skip unless `SQL_PASSWORD` is set. CI (`.github/workflows/ci.yml`) runs
fmt-check, typecheck, `deno task test`, then `deno task build`. The workflow
only checks; deployment is separate (see the deploy warning above): `deploy.yml`
deploys prod to the EC2 cohost after CI passes on `prod`, and `deploy-dev.yml`
deploys the dev instance.

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

`public/` holds the static shell (`index.html`, `sw.js`, `styles.css`, the
manifest), the self-hosted fonts, icons and share card, and two debug pages; see
`public/CLAUDE.md`.

## Where the detail lives

Each area's architecture notes live in a `CLAUDE.md` beside its code, loaded
automatically when you work in that directory. Read the relevant one before
changing an area, including from elsewhere (a server change the client depends
on, say):

- `common/CLAUDE.md` — the pathing engine (`common/pathing.ts`).
- `server/CLAUDE.md` — entry, router, the one-endpoint API, `boot`/`dayView`
  composition, crons, push notifications, the Discord posts, environment
  variables, observability, and the build SHA / stale-client reload.
- `server/db/CLAUDE.md` — **migrations (read before adding one)**, the two DB
  transports, and the `sql`/`sqlOnce` choice.
- `client/CLAUDE.md` — boot, the API client, stores and the game loop.
- `i18n/CLAUDE.md` — catalogs, `t(...)`, and picking the language.
- `public/CLAUDE.md` — the static shell, fonts, icons and the share-card policy.
- `deploy/README.md` — the EC2 box: setup, operating, backups and restore.

## Domain model & invariants

Tables: `user`, `iteration`, `block` (an iteration's fixed pieces, kind
`block|thunder`), `run`, `notification`, `push_subscription`, `pb_top`. Key run
flags — get these right, they encode the whole competitive model:

- **`ranked`** — this run is one of the daily's three counting attempts.
  Recorded **only at `startRun`**, because it depends on the player's _claimed
  local day_ (from their timezone), and a daily's legal window spans ~50h of
  server time so it can't be inferred later from `created`. Read everywhere
  else. The claimed zone must be a named IANA zone (`util/dailyParts.ts`):
  ECMA-402 also accepts raw offsets like `"+23:59"`, which would stretch that
  window past the real −12..+14 range, so offset zones are a `UserError`.
  `startRun` counts only `ranked` runs toward the three, as the board gate and
  the client do: unranked rows on today's board (a merge's demoted attempts)
  must not use them up.
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
- **`trace`** — how a ranked attempt was built, kept for solver review and never
  shown in the app (`common/runTrace.ts`). Each `updateRun` carries the edits
  since the last confirmed save, timed as client ages (ms before the send), and
  `updateCurrentRun` appends one JSON line per save stamped with the server's ms
  since `created`, so a log can't be written after the fact without being sent
  live. A missing or malformed trace still saves (its line has no `p`); free
  play keeps none.

Other invariants:

- **The run lifecycle splits by type, to keep request volume down and survive
  deploys.** A **ranked** attempt keeps the server bookends: `startRun` (stamps
  `ranked`, opens the authoritative 60s window) and per-build `updateRun`s,
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
  **retryable**: a connection dropped by a deploy retries onto the restarted
  server and lands rather than losing the run. Beyond those retries the executed
  maze sits in a **commit outbox** (`freePlay.ts`, `localStorage`) from before
  the send until the server answers for it (a 5xx stays queued, a verdict on the
  maze is dropped), and is re-sent after the next boot, on `online`, and after
  any landed commit — the client_id makes the replay a no-op if the first send
  did land. The outbox keeps only the **best** queued run per board (per player;
  a tie keeps the earlier), since only the best can move a record — every run is
  still sent at execution, only the retry queue is thinned. `commitRun` stays
  backwards compatible — a legacy cached client that still
  `startRun`+`updateRun`+bare-committed hits the old flip-void path (no
  `blocks`). Trusting the client on free play is deliberate: it's post-ranked,
  never feeds ELO, and the server still recomputes the time from the submitted
  maze — only the 60s budget is client-enforced. The ranked server window
  (`updateCurrentRun`) is an elapsed-seconds `< 61`, deliberately: over
  whole-second timestamps `< 60` closed 0–1s _before_ the true 60s, more than
  `SAVE_GRACE_MS` covers; `< 61` never closes before insert + 60s and at most 1s
  after. Freshness is computed once (`@fresh`) and gates the UPDATE, so `saved`
  always matches whether the write happened.
- **Free play is gated only on the player's own today and later.**
  `util/boardAccess.ts` (`checkBoardAccess`) is the one gate, for `getBoard` (so
  `boot` and `dayView` too), a free-play `startRun` (numeric iteration) and
  `commitRun` (both shapes; it carries the client's `timeZone`, and a cached
  client that sends none is read as the westernmost zone, `Etc/GMT+12`). Every
  day before the caller's local today is **open** — any past date, including the
  one that just rolled over, is replayable at once, even with today's daily
  still outstanding. Their own today is **locked** until they have opened three
  `ranked` attempts on it (no previewing/practising the puzzle you're about to
  rank), and a later day is locked outright: tomorrow's iteration exists (the
  gen cron runs a day ahead), and before this gate it was one request away.
  `updateRun` with no run on the iteration answers `expired` rather than
  `validateRun`'s reason, which would map a locked board cell by cell. This is
  deliberately **minimal** anti-cheat: "today" is the timezone the client
  claims, and a throwaway id that spends three attempts unlocks the board too;
  neither is worth more machinery when multi-accounting and solvers are open
  anyway. A locked `getBoard` answers a plain **`{ incomplete: true }` (200),
  never an error** (a locked free-play `startRun`/`commitRun` is a 403 — no
  honest client asks) — "not yet" is a state, not a fault, and it leaks nothing
  either way. It must not be an error: `client/api.ts` relays **every** error
  response to `reportClientError` before the caller can swallow it, so a routine
  "not yet" would log a server-side error from every path that legitimately
  lands on an unfinished today (the regrade refetch, a notification tap, a today
  permalink, a calendar pick while parked on a past day). Consumers already
  branch on `"incomplete" in r` (`store/board.ts`, `useInit`'s regrade);
  `showBoard` re-requests once on `{ incomplete }` so a stale prime (notably the
  linked-day slice a `/YYYYMMDD`-for-today boot stashes) can't wedge the first
  real stage. **Ranked play is a strictly local-day affair** — the client
  hard-cuts a ranked attempt's build window at the player's local midnight (an
  in-progress attempt executes early; no further attempts open on the old day),
  and surfaces the new day via an explicit switch
  (`client/store/dailyRollover.ts`).
- `standing(time, min, best)` (`common/standing.ts`) is the one shared
  position-in-field formula used by every surface; `min` is the time of the base
  board's unobstructed shortest path, stored on the iteration. It's a
  _practical_ floor, not a strict one: the solver minimizes distance, not time,
  so a maze that reroutes the runner clear of a fixed thunder's slow can in
  principle come in under it (see `scripts/comparePathing.ts`) — `standing`
  clamps a below-`min` time to 0.
- **Profile stats (`getUserStats`)** are all derived from stored runs — no
  column of their own. A day counts once the iteration is `rated` (closed for
  every timezone), and only days with a field: **days won** splits sole (gold)
  from shared (lime), never breaking a tie by who got there first, which would
  favour early timezones. A **solve** is a ranked attempt equal to the board's
  CURRENT best build, free play included, so it means "nobody has ever done
  better" and is lost again when someone builds longer — deliberately live, not
  frozen at the day's close. **Free play** is one tally (supremes · records ·
  boards played · boards), with no denominator behind the holdings: a completion
  bar there would invite grinding every board to its ceiling. **Head-to-head**
  ships one row per rival with both boards' records (daily = ranked days both
  played, pb = boards both built on), each appearing only after 5 meetings, and
  carries `name` + `hue`, never the rival's id. It all runs on every boot, so
  each field-side query is reached through the iterations the player has runs on
  — cost follows the player's history, never the whole run table. What it
  deliberately does NOT show is anything measuring the player against a computed
  ceiling: telling the leader they could do better is what makes a record feel
  like a chore.
- **Identity / move / merge:** the UUID in the `authorization` header _is_ the
  bearer credential — there's no password, so possession alone _is_ the whole
  authorization. That's a sensitive credential: anyone who obtains it can act as
  (or merge away) that user, so it must be protected like one. But possession is
  deliberately made _sufficient_ — that's exactly what powers "move to device":
  it issues a `/#l=<id>` link/QR (`signInLink`, `client/util/id.ts` — the id
  rides the URL **fragment**, which never reaches the server, because a path
  segment lands verbatim in nginx's access log and Deno's OTel span
  `url.full`/`url.path`, neither of which app code can scrub). The legacy
  `/login/:id` and `/l/:id` path forms still work for links already in the wild;
  our own log lines redact them (`redactPath` in `middleware/beginLogger.ts`),
  but the span and nginx still see those. Holding two ids authorizes folding
  them (`routes/merge.ts` → `db/merge.ts` reassigns runs and deletes the loser
  row in one transaction; a nonexistent primary is a 400). The merge must not
  mint attempts: on any iteration where the primary already has a ranked
  attempt, the secondary's runs there move as history (`ranked`/`daily` cleared)
  — otherwise `daily`'s best-ranked re-point would make it best-of-six — and
  `pb_top.top_user` (no FK) is rewritten to the primary. The client-side gate is
  `MoveGate`/`MoveDevice` — which adopts the link's id only after `merge`
  succeeds: adopting over a failed merge would overwrite the device's only copy
  of its old credential. A link never changes a profile with runs without an
  explicit choice: no silent merge however lopsided the sides (a run-heavy link
  posted publicly would otherwise absorb every small profile that opens it), and
  a link naming no known profile is dropped with a toast rather than adopted.
  Link ids of a shape the server never mints are ignored. `extractUserId` admits
  only the id shape ever minted (`[A-Za-z0-9_-]{1,36}` — `user.id` is char(36));
  any other header is treated exactly like a missing one (anonymous, so authed
  methods 401), logged by length only.
- **Data rights (GDPR export / erasure):** two authed API methods, both surfaced
  in Profile → Account. `exportData` (`routes/exportData.ts` → `db/export.ts`)
  returns everything held about the caller (user row, all runs incl. void,
  notifications, push endpoints, the top-PB records it holds) as one JSON
  document the client offers as a download. `deleteAccount`
  (`routes/deleteAccount.ts` → `db/deleteAccount.ts`, `anonymizeUser`) is
  **anonymize-in-place, not a row delete**: it hard-deletes the caller's push
  subscriptions + notifications (nothing else is computed from them), then
  rotates `user.id` to a fresh random UUID and clears `name`/`settings`/`locale`
  (and points `pb_top.top_user`, which has no FK to cascade, at the new id). The
  runs ride along via `FK_run_user ON UPDATE CASCADE`, so the player's build
  history survives as one distinct **anonymous** competitor — the day's field,
  others' percentiles, and the applied ELO deltas aren't rewritten, and every
  `JOIN user` still resolves. The new id is never returned, so the link to the
  person is gone (anonymization, not pseudonymization). Each erasure posts the
  old id's **hash** (never the id) to the admin Discord channel: an off-box
  ledger that lets `scripts/reapplyErasures.ts` re-apply deletions after a
  restore even if the box and its logs are lost. The op is an idempotent no-op
  on retry (the old id is gone), but `deleteAccount` is still **excluded from
  the client `RETRYABLE` allowlist** because on success the client mints a fresh
  local id + reloads, so a blind retry would act on the stale id. The confirm is
  gated behind typing "DELETE" (`DeleteAccount.tsx`). `/privacy.html` is the
  disclosure page linked from the same panel (the SQL proxy is first-party
  infra, not listed as a third-party recipient). It is **server-rendered in the
  reader's language** (`server/privacy/page.ts`: an explicit `?lang` — the
  in-app link passes the player's chosen language — then `Accept-Language`, then
  English), from its own catalog (see Localization), with a translation notice +
  English link on non-English copies and a per-language footer. Its "Last
  updated" is the hand-set `UPDATED` constant — bump it for a change in what the
  page says, never for a translation — beside a link to the public git history
  of `i18n/privacy/en.json`, the exact record. It stays script-free: the rights
  cards link INTO the app rather than exporting or erasing themselves —
  `/?profile=account` opens the Profile dialog on its Account section,
  `/?profile=delete` the delete-confirm sheet (`takeProfileRequest` in
  `store/notifNav.ts`, taken once by `Profile`). The link works even with
  today's daily outstanding, when the profile BUTTON is hidden (data rights
  can't wait on three ranked attempts) — it's held only through boot and a live
  build/run, so it never lands over an attempt's clock. In-app, the same request
  (`requestProfile`) is raised by the prestart overlay's quiet "Account &
  privacy" footer — the route to those controls while the button is hidden,
  deliberately a text link rather than the button itself, which drew too much
  attention on the start screen. The in-app link opens it in the **same window**
  on purpose: an iOS home-screen app opens a new tab in a browser view with its
  own storage, where those links would act on a fresh anonymous player instead
  of this one.

## Operational scripts (`scripts/`)

Dry-run by default, `--apply` to write; run locally against an env with
`APP_ENV=... SQL_PASSWORD=...`:

- `auditRuns.ts` — recompute every non-void run with `validateRun` and delete
  illegal ones.
- `comparePathing.ts` — quantify a pathing change against all stored runs before
  shipping it (with `--apply`, writes recomputed optimal times).
- `comparePathViz.ts`, `genVapidKeys.ts` — path visualization / VAPID keygen.
- `reapplyErasures.ts` — after restoring a backup, re-anonymizes every player
  who used "Delete my data" since it was taken, matched by the `userHash` their
  `deleteAccount` request logged (stdin, one per line). Backups (nightly dump +
  EBS snapshots, kept ≤30 days — the bound the privacy page states) are
  described in `deploy/README.md` "Backups".
- `symbolicate.ts` (`deno task symbolicate <clientSha> < stack.txt`) — maps a
  minified client stack (`client.error`) back to source. The client bundle is
  minified and its map is never served (browsers don't apply maps to
  `error.stack` anyway); `build` moves it to `sourcemaps/<SHA>/` (gitignored,
  newest 20 kept), keyed by the `clientSha` each request logs. With no stored
  map the script rebuilds that commit in a temp worktree: the bundle is
  deterministic and an external map leaves its bytes unchanged, so the rebuild
  matches given the same Deno version.

## Conventions

- This codebase documents intent in **prose comments** — the _why_, edge cases,
  and race conditions are written down at the point of code. Match that style;
  read the surrounding comments before changing timing, run-lifecycle, or
  migration logic, they encode incidents.
- Comments state what is true now. Keep the why and the guardrail ("don't do X;
  it causes Y"); leave out the history of how the code got here ("used to",
  "now", "before this"), narration of the next line, and notes to a reviewer —
  git and the PR hold those. Name things exactly (`anonymizeUser`,
  `util/boardAccess.ts`) so a rename leaves a greppable trail. A comment that no
  longer matches the code is a bug: fix it in the same change.
- `deno fmt` is authoritative (CI fails on drift), but it doesn't rewrap
  comments in code; keep them to 80 columns by hand. There is no README: the
  `CLAUDE.md` files, `deploy/README.md` and the inline comments are the
  documentation.

## Maintaining these files

Keep the CLAUDE.md files current as part of the change that makes them stale —
this is the "kept up to date" mechanism for LLM-first docs. Update them when
you: add/rename an API method or route, change a run-lifecycle flag or its
invariants, alter the pathing/timing semantics, add a cron, change build/test
commands or env vars, or add a migration that shifts the schema story. Put a
fact in the file for the directory it describes, once; this root file keeps only
what spans areas, and links out rather than repeating. Write rules, not history:
git holds what changed and why, and a doc keeps only the lasting rule. A
one-line touch that keeps a future session from having to re-derive the
architecture is worth it.
