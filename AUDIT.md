# Codebase audit — 2026-07-07

Findings from a full read of the client (~6k LOC), the API layer, and the
server's run lifecycle, DB, and routing code. Organized as a working checklist:
tick items off (and note the PR) as they land.

Focus areas requested: client race conditions, serial async calls, optimistic
rendering opportunities, a true client data model/store (Apollo-like), and
general engineering review.

---

## 1. Concrete bugs

- [x] **1a. Moving a block in free play commits the run (drops `freePlay`).**
      _Fixed in #93 — the client flag is removed entirely; ranked-ness is now
      recorded on the run row at start time (where the timezone-aware daily
      check lives — see 1h) and the write path commits off that flag._
      `client/components/Game/useInputEnd.ts:117` — the drag-to-move branch
      calls `api.updateRun({ iteration, blocks })` **without** `freePlay`,
      unlike the place (line 161), upgrade (line 88), and delete (line 46)
      branches. The server treats absent `freePlay` as a daily commit
      (`server/routes/iteration/run/update.ts:53` passes `!freePlay` as
      `commit`), which sets `void = FALSE` and runs the daily-reassignment SQL.
      Consequence: a free-play build in which the player merely repositions a
      block is committed immediately — Reset/leave still counts the "abandoned"
      run toward history and field best, breaking the "void until it executes"
      invariant.

- [x] **1b. `reportClientError` can recurse infinitely.** _Fixed in #93 — a
      failed `reportClientError` is never itself reported._ `client/api.ts:47`
      and `:55` — every failed request fires `api.reportClientError(...)`, which
      itself goes through the same proxy. If the server is returning errors or
      non-JSON (outage, proxy HTML error page), each failed report triggers
      another report, unboundedly — a self-inflicted request storm exactly when
      the server is least healthy. Fix: exempt `reportClientError` from error
      reporting, or add a throttle/one-shot guard.

- [x] **1c. Placements in the final seconds are shown as saved but silently
      dropped.** _Fixed in #94 — `updateRun` returns `{ expired: true }` when
      the window closed (checked off the run row's age, not `changedRows`); the
      client keeps edits optimistic, tracks the last server-accepted maze
      (`savedBlocksRef`), and on expiry snaps back to it and starts the run (the
      server already has); on a rejected save it reverts and keeps building. No
      error rendered._ `server/db/run.ts:97` only persists within the 60s window
      (`TIMESTAMPDIFF(SECOND, created, NOW()) < 60`). When the window has just
      closed, `changedRows === 0` is merely logged
      (`server/routes/iteration/run/update.ts:55-57`) and the route **still
      returns the new path/duration as success**. The client clock starts an RTT
      after the server's, so a placement at client-time ~1s remaining can miss
      the window: the board animates the new maze but the persisted run doesn't
      include it. The route should return a "stale/expired" result the client
      can surface.

- [x] **1d. `memoize` caches rejected promises forever.** _Fixed in #94 —
      rejected promises are evicted so the next call retries; `trailer` also
      retries a failed initial fetch and keeps serving the stale value when a
      background refresh fails (both previously wedged on the rejected
      promise)._ `server/db/iteration.ts:10` (`getIteration`) +
      `server/util/memoize.ts:52-58` store the promise synchronously. One
      transient DB failure caches a rejected promise served to every subsequent
      request until the isolate recycles. Fix: `.catch()` → `bust()` on
      rejection.

- [x] **1e. Non-idempotent SQL is retried.** _Fixed in #94 — a no-retry
      `sqlOnce` tag covers the two non-idempotent statements (`startRun`'s and
      `createIteration`'s bare INSERTs); the remaining writes are idempotent
      (upserts / absolute-value UPDATEs), where retry is safe and stays on._
      `server/db/query.ts:13` — `query()` defaults to one retry on
      timeout/network failure for _every_ statement, including `startRun`'s
      `INSERT INTO run`. A 3s timeout where the write actually landed
      re-executes the INSERT on retry — a duplicate run row, i.e. a silently
      spent daily attempt. Restrict retries to reads, or make writes idempotent
      (client-generated run id + unique key).

- [x] **1f. Dead/broken files.** _Swept in #96: deleted `useConnectionState`
      (broken import), `useApi`, `getUserPlays`, `getCurrentRun`,
      `dailyAttemptsByIteration`, and `getLatestRun`'s unread `daily` field.
      `abandonRun`/`voidCurrentRun` stay until their stated stale-client window
      closes (~2026-07-13) — remove then. The `deno check` CI blind spot
      (entrypoint graphs only) remains worth knowing about._
  - `client/hooks/useConnectionState.ts` imports `../contexts/Connection.ts`,
    which doesn't exist. Only type-checks because nothing imports it, so it's
    outside the `deno check` graph. Delete it (and note the CI blind spot:
    `deno check` only covers the three entrypoint graphs).
  - `client/hooks/useApi.ts` is entirely unused (everything uses
    `useApiListener` + direct `api.*` calls); it also contains a stale-response
    race (no latest-wins guard). Delete rather than fix.
  - `server/routes/iteration/run/abandon.ts` is registered in the API but never
    called by the client. Wire it up or remove it.
  - `getUserPlays` (`server/db/user.ts:40`) has no callers (found 2026-07-07
    while validating `daily`'s consumers — see 6g). `getCurrentRun`
    (`server/db/run.ts`) likewise. `getLatestRun` returns a `daily` field its
    only caller never reads.

- [x] **1g. Daily resume trusts the `daily` flag, which an in-progress attempt
      2/3 usually doesn't hold.** _Fixed in #93 — `getLatestRun` filters on the
      recorded `ranked` flag instead._ (Found 2026-07-07 while reviewing #93.)
      The `daily` column means "the user's single counted result" — exactly one
      `TRUE` per user/iteration, re-pointed at the best of the first three on
      every ranked save — not "this run is a ranked attempt": attempts 2/3
      insert `FALSE` and only gain the flag while beating the earlier attempts.
      But `getDailySummary` locates the in-progress run via
      `getLatestRun(userId, id, /* dailyOnly */ true)`
      (`server/routes/iteration/daily.ts:46`). Refresh mid-attempt-2 while
      behind attempt 1 and it finds attempt 1 instead (old `created` →
      `remainingTime <= 0` → `currentRun: null`), so the boot flow
      (`App.tsx:110-112`) calls `startRun` and silently spends attempt 3 while
      attempt 2's 60s window is still open. Fix: resume from the latest run
      among the ranked three (the same first-three/same-day predicate #93 uses
      for commits — or a dedicated `ranked` column set at insert), not from
      `daily = TRUE`.

- [x] **1h. Server-date predicates break for timezone-offset players.** _Fixed
      in #93 — a `ranked` flag is recorded on the run row at start time (v3
      migration + windowed backfill) and read everywhere the date predicate
      lived._ (Found 2026-07-07 during #93 review.) A daily is pinned to the
      player's claimed local day (`dailyParts(timeZone)` at `startRun`), so
      iteration X is legally "today" for ~50 hours of server time — UTC+14
      enters X at X−1 10:00 UTC, UTC−12 leaves it at X+1 12:00 UTC (the window
      `getUnratedClosedIterations(hours = 37)` already waits out), and a
      traveler can legally spread three attempts across it. Every
      `DATE(run.created) = DATE(iteration.created)` predicate therefore
      misclassified legal attempts landing on a neighbouring server date. Three
      consumers were affected: `allRunsByIteration` marked them unranked (no
      Daily badge, and voided-but-spent attempts hidden from the panel); the
      `daily` demote/promote in `updateCurrentRun` matched nothing, so the
      counted result stayed stuck on attempt 1 from insert — a **scoring bug**,
      offset players' percentile-field contribution being attempt 1's time even
      when a later attempt was best; and #93's original commit derivation copied
      the predicate, which would have stopped offset players' attempts
      committing at all.

      Ranked-ness can only be decided at start time, when the claimed timezone
      is in hand — any inference from `created` misfires on prompt free-play
      replays of a neighbouring day inside the window. The backfill
      approximates history with the full legal window.

---

## 2. Race conditions on the client

- [x] **2a. `updateRun` has no ordering — two races in one.** _Fixed in #95 —
      saves are serialized client-side through a trailing-edge queue of depth 1
      (`runSaver.ts`): at most one in flight, newer edits coalesce to the latest
      full maze, so out-of-order writes and stale responses can't happen. Chosen
      over a `seq` column: no migration or protocol change, and each save
      already carries the whole maze._ Every build action fires `api.updateRun`
      fire-and-forget from inside a `setBlocks` updater (`useInputEnd.ts:46`,
      `:88`, `:117`, `:161`). Two rapid actions create two in-flight POSTs:
  - _Server:_ last-arrival-wins on `UPDATE run SET data = ...` — if request B (2
    blocks) is overtaken by request A (1 block), the persisted maze is the older
    one. No sequence number, no version check.
  - _Client:_ each response dispatches an `updateRun` event, and
    `useInit.ts:268-271` does `setRun(...)` on every one. Out-of-order responses
    flip the board's path/duration to a stale run — and `run.duration` feeds the
    HUD and the free-play verdict/optimistic panel row at commit time
    (`useInit.ts:221`).

  Fix: client-side monotonically increasing `seq` per run; server refuses older
  writes; client ignores responses whose seq isn't the latest sent.
  Alternatively serialize on the client (a per-run trailing-edge queue of depth
  1 that coalesces to the latest maze).

- [ ] **2b. Board-loading responses race with each other.**
      `getBoard`/`startRun` responses drive the board via global emitter
      listeners (`useInit.ts:147-154`). Click day A then quickly day B in the
      calendar: whichever response arrives _last_ stages the board, which may be
      A. Same for `TodayResult`/`Profile`'s
      `getBoard().then(() => api.best(...))`. No request identity anywhere. Fix:
      a `wantedIteration` ref set at click time (or a request id) and drop
      mismatched responses. Falls out naturally of the store proposal in §5.

- [x] **2c. Failed writes are silently swallowed — optimistic state with no
      reconciliation.** _Fixed in #95 for the build path — the run saver retries
      the latest maze with backoff on network failure (silently, per the
      smooth-over-error-UI direction), and at run start `finalize` cancels
      pending work and snaps any still-unconfirmed edit back to the accepted
      maze (with the implosion), so the animation always matches what the server
      scores. A late response from a previous board generation is ignored.
      `startRun`/`commitRun` failures remain unhandled (rarer; board-load retry
      is 4a/store territory)._ All `updateRun`/`commitRun`/`startRun` calls in
      the input path ignore rejections (a network drop during a build = board
      and server permanently diverge; the run scores off the last maze that
      happened to save). There's an `error` event on the emitter
      (`client/api.ts:51`) but **nothing subscribes to it**. At minimum:
      subscribe once, show the `Disconnected` treatment, and re-send the current
      maze (the payload is the full block list, so a retry-with-latest-state
      loop fixes both dropped and reordered writes).

- [x] **2d. Countdown clock drift.** _Fixed in #95 — the countdown derives from
      a wall-clock deadline (`deadlineRef`, set when a run loads) on a 250ms
      tick, so a throttled background tab catches up to the honest value —
      including 0, which starts the run — instead of lagging the server's
      window._ `useClock.ts:12` decrements a counter with
      `setInterval(…, 1000)`. Intervals throttle in background tabs and drift
      generally, while the server enforces wall-clock 60s — the player can still
      be "building" after the server window closed (compounds 1c). Fix: compute
      remaining time from a deadline timestamp (`start + 60_000 - Date.now()`)
      on each tick.

- [ ] **2e. Runner finish depends on Preact's render timing.**
      `client/components/Runner.tsx:29` schedules the next
      `requestAnimationFrame` _before_ checking for finish, and on finish calls
      `onFinish()` + dispatches `runFinish` without cancelling the queued frame.
      It works because Preact flushes `setRun(undefined)` on a microtask before
      the next frame unmounts the component — incidental. If anything defers
      that render, `runFinish` fires every frame and `useInit`'s handler fires
      `startRun`/`getDailySummary` repeatedly. Fix: `return` before scheduling
      the next frame, or a `finished` flag.

- [ ] **2f. Side effects inside state updaters.** `api.updateRun(...)` +
      `rebuildGrid(...)` live _inside_ `setBlocks(prev => …)` updater functions.
      Preact currently invokes updaters once, but updaters are contractually
      pure — under React (or double-invoke tooling) each placement double-fires
      the API call. Compute `newBlocks`, then `setBlocks(newBlocks)`, then call
      the API.

---

## 3. Server-side notes

- [ ] **3a. No transactions on the run write path.** `updateCurrentRun`'s commit
      branch is three sequential statements (`server/db/run.ts:99-140`) with no
      `START TRANSACTION` (unlike `mergeUsers`, which does it right). A failure
      between statements leaves `void = FALSE` with daily flags half-reassigned;
      concurrent updates from 2a interleave here too.
- [ ] **3b. `startRun` TOCTOU.** The "first run / is daily" checks ride session
      variables in one batch, but nothing prevents two concurrent `startRun`s
      (double-click, retry from 1e) from both inserting. Unique constraint or
      `INSERT ... SELECT ... WHERE NOT EXISTS`.
- [ ] **3c. `getDailyIterationId` returning `undefined`** (no daily generated
      yet for that date) flows into `getIteration(undefined)` → unhandled 500
      rather than a clean error.
- [ ] **3d. `server/routes/iteration/daily.ts:104`** throws
      `"Unexpected invalid path on daily recovery"` — one corrupt persisted maze
      makes `getDailySummary` (the boot call!) 500 for that user for the rest of
      the 60s window. Degrade to `currentRun: null`.
- [ ] **3e. Auth model.** The user id _is_ the bearer credential
      (`server/middleware/userid.ts`) and rides in `/l/<id>` URLs (history,
      logs). Accepted trade-off for a frictionless game, but `merge` is the
      dangerous verb: anyone who sees a login link can merge that account away.
      Consider single-use link tokens that resolve to the id server-side.
- [ ] **3f. Unbounded memo maps.** `trailer(getIterationOtherBest)`
      (`server/routes/iteration/run/update.ts:23`) memoizes per
      `(iteration, userId)` in a plain `Map` for the isolate's lifetime. The
      existing-but-unused `server/util/LRUMap.ts` is the right container here.

---

## 4. Serial async calls & optimistic rendering opportunities

- [ ] **4a. Boot waterfall (the big one).** Cold load: `getDailySummary` (RTT 1)
      → _then_ `startRun` (RTT 2) before the board is playable, with
      `getProfile` and the calendar's `list` also gated behind RTT 1
      (`client/components/App.tsx:95-116`). Options, increasing effort:
  1. Fire `getProfile` + current month's `list` in parallel with
     `getDailySummary` (the name-seeding order concern only matters on a user's
     very first ever load — `getDailySummary` calls `createOrUpdateUser`
     server-side anyway).
  2. Let `getDailySummary` _auto-start_ the run when there's no current run and
     attempts remain — collapse RTT 2 into RTT 1.
  3. A single `boot` endpoint (summary + profile + current month) — one RTT to
     interactive.
- [ ] **4b. "Keep playing" / Reset / day-switch round trips.**
      `clear(); api.getBoard(...)` (`Daily.tsx:226`, `Hud.tsx:98`,
      `Calendar.tsx:193`) blanks the board and waits a full RTT for data the
      client largely already has (fixed pieces, checkpoint, budgets, min/best
      all arrived with the previous `startRun`/`getBoard` for that iteration).
      With an iteration cache (§5) stage instantly from cache and reconcile on
      response — the same pattern the optimistic runs-panel row
      (`useInit.ts:226-247`) already does.
- [ ] **4c. View-best waterfall.** `Profile.tsx:113` and `TodayResult.tsx:50`:
      `getBoard(...).then(() => api.best(...))` — two serial RTTs to look at a
      maze. Fire in parallel and stage when both land (or have `best` return the
      board too).
- [ ] **4d. More optimistic surfaces.**
  - Result modal: on the last daily finish the client already knows all three
    durations — render optimistically, fill percentiles when the summary lands.
  - Rename (`Profile.tsx:96`): patch cache first, roll back on error.
  - Settings: local-first + debounced persist is already good; handle a failed
    `setSettings` (currently silent cross-device divergence).

Already well done and worth extending as the house pattern: free-play start
riding the first placement on `startRun`
(`server/routes/iteration/run/start.ts:69-96`), and the commit-time optimistic
panel row with supreme re-scoring (`useInit.ts:226-247`).

---

## 5. A true client data model / store

Server state currently lives in **four parallel systems**: the module-level
emitter (last-response-per-method via `useApiListener`), `DailyItemsStore` (a
`Map` + manual `applyRun` patch), the `useProfile` module cache (subscribers +
staleness window), and `useSettings` (another module cache). Plus
`GameStateContext`: one hook with ~30 `useState`s whose returned object is
rebuilt every render, so **every context consumer re-renders on any change** —
including `setPlacingBlock`, which fires on every `mousemove`
(`useInputStart.ts:120,135`). The whole game tree re-renders at pointer speed;
fine while the tree is small, first thing to hurt as it grows.

No need for Apollo. For a Preact app this size, the natural shape is
**`@preact/signals` + a thin typed query/mutation layer** over the existing RPC
proxy:

- [ ] **5a. Normalized entity cache.** Three entity types cover almost
      everything, keyed by `iteration` (which every response already carries):

  ```
  iterations:  Map<iterationId, IterationBoard>  // fixed pieces, checkpoint, budgets, min/best/ownBest
  attempts:    Map<iterationId, Attempt[]>       // what viewedAttempts/applyRun juggle today
  profile:     Signal<ProfileData>
  dailyItems:  Map<iterationId, DailyItem>       // exists — fold it in
  ```

  Route _all_ responses (`getBoard`, `startRun`, `getDailySummary`, `list`)
  through one `ingest(response)` that upserts these maps — instead of five
  listeners each hand-copying ~12 fields into game state (`handleRun` /
  `handleStaged` are 90% duplicated plumbing). `applyRun`'s manual
  best/dailyBest recomputation becomes a _derived_ (computed) value from
  `attempts`, not a hand-maintained patch mirroring server logic.

- [ ] **5b. Query layer** (~80 lines that replace Apollo): per-key request state
      with dedupe, staleness, and latest-wins:

  ```ts
  const board = query('board', (iteration) => api.getBoard({iteration, ...}), {staleMs: 30_000})
  board.fetch(5)   // dedupes in-flight, ignores out-of-order responses (fixes 2b)
  board.data       // signal — components subscribe with zero re-render plumbing
  ```

  `useProfile` (dedupe + staleness + subscribers) is already this, hand-rolled
  for one endpoint — generalize it rather than writing a fifth cache.

- [ ] **5c. Mutation layer** with the three things §2 shows are missing:
      **sequencing** (per-run trailing-edge queue for `updateRun`), **optimistic
      apply + rollback**, and an **error/retry policy** (surface `Disconnected`,
      re-send latest maze). Signals give fine-grained subscriptions for free —
      `bricks` as its own signal means only the HUD chip re-renders on
      placement; `placingBlock` stays out of the render path for components that
      don't draw it.

- [ ] **5d. Model the board phase explicitly.** The board's mode is encoded in
      sentinels: `time === -2` (never loaded) vs `-1` (idle/finished) vs `0`
      (run starting), `bricks === -1`, `date NaN`, plus
      `staged`/`freePlay`/`viewing` booleans whose legal combinations live only
      in comments. A discriminated union —
      `{phase: 'loading'|'staged'|'building'|'running'|'reviewing', ...}` —
      makes illegal states unrepresentable and would have made bug 1a hard to
      write.

**What stays out of the store:** truly ephemeral interaction state — `dragRef`,
`placingRef`, hover/preview, `touching`, the mutable pathing `grid`. That's UI
state; refs/local signals are the right home. The win is separating it from
_server_ state, currently interleaved with it in `useGameState`.

---

## 6. General engineering observations

**Genuinely good:** comment discipline (comments explain _why_ and record
invariants); zod validation on every route with types flowing end-to-end from
`server/routes/api.ts` through the typed client proxy — preserve this in any
refactor; `mergeUsers` is careful, transactional, and documented; the emitter's
snapshot-dispatch and `useApiListener`'s ref-callback pattern are real debugging
scars correctly fixed; CI covers fmt/check/test/build.

- [ ] **6a. Effect dependency churn.** `useInputStart`/`useInputEnd` tear down
      and re-register 4–6 _global_ listeners whenever `time` ticks (every
      second), `blocks`, `bricks`, etc. change; `useInputEnd.ts:199` has
      `placingBlockRef.current` in a dep array (only works because
      `setPlacingBlock` also renders). Register once, read current values from
      refs (`useApiListener` already uses this trick).
- [ ] **6b. `useGameState` is a god object** — 30+ states, every consumer gets
      all of them. Even before a store migration: split it (interaction vs board
      vs meta/panels) and memoize the context value to cut mousemove-driven
      full-tree re-renders.
- [ ] **6c. Duplicated scoring/standing logic.** The `(t - min)/(best - min)`
      clamp appears in `useInit.ts:222-224`, `Calendar.tsx:43-48`, and
      `TodayResult.tsx:16-21`, mirroring server `mapAttempts` — four places to
      drift. Extract `common/standing.ts` used by both sides.
- [ ] **6d. Test coverage gap.** Good for pure logic (pathing, rating,
      validateRun, migrations); zero for the run lifecycle
      (start/update/commit/void state machine — where 1a/1c live) and zero for
      client behavior. The lifecycle is testable as pure route handlers with a
      fake `sql`; highest-value gap.
- [ ] **6e. `useRefState`** (`client/hooks/useRefState.ts`) recreates its object
      each render, so `current` after a same-render write reads stale — used
      once (Markdown.tsx) in a way that survives this, but it's a trap. Replace
      with plain state or a real ref + forceUpdate.
- [ ] **6f. Error surfacing.** No error boundary; `App`'s `disconnected` state
      only covers the boot request; `Disconnected` never shows for mid-game
      failures (see 2c).

- [ ] **6g. Optional: retire the `daily` column.** (Consumers validated
      2026-07-07.) Post-#93, `daily` means exactly one thing everywhere — the
      user's counted result, i.e. their best non-void **ranked** run on the
      iteration — and has always meant that (git: the earliest visible schema
      seeds only attempt 1 at insert and re-points the flag at the best via the
      inline reassignment; the dead `markDaily` removed in #52 was literally
      "flag the single best non-void run"). Its live readers: rating
      (`getRatingParticipants`, `getIterationDailyTimeCounts`), the live
      percentile field (`getIterationTimeCounts`), the calendar (`listDailies`'s
      `ownDailyBest`/`dailyBest`/`dailyPercentile`), and the profile (`played`,
      median percentile, records). All of those reduce to
      `MAX(time) … WHERE ranked AND NOT void GROUP BY user`, so the column is
      _almost_ derivable — the one non-derivable bit is `mergeUsers`'
      earliest-day-wins policy (a merge must not cherry-pick the faster day).
      Retiring `daily` therefore requires moving that policy into `ranked`
      (demote the losing day's ranked flags at merge), rewriting the four reader
      queries as per-user MAX subqueries (losing the cheap
      `iteration_daily_void_time_idx` index-only aggregation), and dropping the
      demote/promote statements from the `updateRun` hot path. Correct as-is;
      worth doing only as a simplification.

---

## Suggested priority order

1. Fix **1a** (`freePlay` on move) and **1b** (report recursion) — small, real,
   user-visible.
2. Add `seq`/latest-wins to `updateRun` + retry-latest-maze on failure (**2a**,
   **2c**) and make the 60s-expiry explicit (**1c**, **2d**).
3. Server hygiene: transaction around the commit path, no retry on writes,
   memoize rejection handling (**1d**, **1e**, **3a**–**3d**).
4. Introduce the ingest + query/mutation layer (**§5**), migrating
   `getBoard`/`startRun` first — the waterfalls (**§4**) and response races
   (**2b**) all collapse into one mechanism.
5. Delete dead code (**1f**), split `useGameState` (**6b**), extract shared
   standing math (**6c**).
