# client/ — architecture

Loaded when working under `client/`. The root `CLAUDE.md` covers the whole repo:
what the game is, commands, the import rule, and the domain invariants every
area relies on.

## Boot, the API client and state

**Boot (`client/index.ts`):** installs error reporting → applies cached theme →
**primes** the boot API calls (`primeSession`, fired during module eval so round
trips overlap the first render; skipped mid-onboarding, since the tutorial
outlasts a prime's lifetime — finishing it primes instead) → renders `App`
inside an `ErrorBoundary` → registers the service worker.

**API client (`client/api.ts`):** a `Proxy` typed as `BlocktolApi` —
`api.foo(x)` POSTs to `/api/foo`. It also _is_ an event emitter (every
successful response dispatches an event keyed by method; `error` is its own
channel), which `hooks/useApiListener.ts` and the stores subscribe to. `prime()`
stashes an in-flight boot response for the next call of that method to consume.
Retries (transport failures only, never an API error answer) are gated by a
`RETRYABLE` allowlist — non-idempotent lifecycle writes (`startRun`/`merge`, and
`updateRun`, which has its own saver) are deliberately excluded. "Transport"
includes a **502/503/504 or any non-JSON body** (`TransportError`): nginx's HTML
page while the upstream restarts is not our handler answering, so it retries and
feeds the connection tracker like a rejected fetch. `commitRun` **is**
retryable: its free-play `INSERT` is `client_id`-guarded (idempotent) and the
legacy path is an idempotent flip-to-non-void, so a deploy-dropped commit can
safely retry. Error answers are relayed to `reportClientError` through the same
dedupe/cap as crash reports (`util/reportGate.ts`, keyed method + status).
`withKeepalive(fn)` marks the requests `fn` issues `keepalive` (the ranked
saver's flush on `pagehide`/hidden).

**State — `@preact/signals`, not context** (writes bypass the render path):

- `client/store/*` are module-level signal stores fed by the api emitter:
  `board` (normalized per-iteration board cache + `showBoard`/`startDailyRun`
  loaders with a monotonic seq token so out-of-order responses can't stage a
  stale board; a Start whose `startRun` answer is lost re-checks
  `getDailySummary` and resumes the attempt if the server opened it — one more
  ranked run than were spent — instead of re-enabling a button that would burn a
  second one), `standings`, `profile`, `notifications`, `notifNav` (deep-link
  routing — effectively the app's router), `connection` (drives the Disconnected
  overlay — blocking, except over a staged free-play board, which plays offline
  and gets a non-blocking pill instead), `dailyItems`, `discord`.
  `store/query.ts` is not a data store but the shared
  coalesce/dedupe/stale-window cache primitive the others build on.
- `client/components/Game/interaction.ts` holds pointer-frequency board state as
  signals so a drag only re-renders the board, not the tree.

## The game loop

**The game loop (`client/components/Game/`):** `useGameState` + `useInit` wire
the board handlers; `interaction.ts`/`useInputStart`/`useInputEnd` handle
placement. Every placement recomputes the runner locally (`localRun` in
`helpers.ts`, on the same shared `cachedSolver` the server validates with) so
the board updates with no round trip; **persistence then splits by run type**
(see the run lifecycle in the root `CLAUDE.md`). Both input hooks read the board
and the budgets through **refs** (`blocksRef`, and `budgetNow` over the totals'
refs), never the render closure they were registered with — Preact re-runs an
effect after paint, so a gesture landing within a frame of the previous one
would otherwise edit a snapshot with that edit undone. And the brick/power
counts are **not state at all**: only the board's `bricksTotal`/`powerTotal`
are, and the remaining pair is a `useMemo` over `mazeBudget` (`helpers.ts`) —
totals minus the maze on the board — with `budgetNow` the same function over the
refs for pointer-time gating. So every path that changes the maze (an edit, a
resume, a revert, a review) is right by construction, and `clear`/prestart blank
the chips by clearing the budget (the `-1` sentinel), not the count. Never step
them (`-1` on a placement, `+1` on a delete): beside a stale write a refund can
outlive its removal, the maze goes one piece over, `validateRun` rejects it at
commit ("too many blocks"), and free play loses the run. **Ranked** goes through
`runSaver.ts` — a **trailing-edge queue of depth 1** (every save sends the full
maze, newer saves coalesce, failures retry with backoff), **debounced** with a
delay that ramps from 2s down to 0 over the final 10s (`saveDebounce`). It also
records the attempt's edit trace (`beginRunTrace`; see `trace` in the root
`CLAUDE.md`): edits are diffed from the saved mazes and queue until a save
carrying them is accepted. At run start `flushRunSaver` **sends** the pending
maze immediately (rather than reverting to the last confirmed one — that would
drop a debounced edit the player hasn't waited out, e.g. tapping "Ready?"
mid-build); if the window has already closed the flush comes back expired and
`onExpired` snaps the board back — blocks AND the run (`revertToSaved`
recomputes it with `localRun`, so the runner walks the maze the server holds).
The saver also flushes immediately (with `keepalive`) when the page is hidden or
unloaded, since a hidden page's debounce timer may not fire until the window has
closed. **Free play** bypasses the saver entirely: `freePlay.ts` mints the
per-attempt `client_id`, mirrors the maze to `localStorage` for reload-resume,
and `commitFreePlay` fires once at execution (through the commit outbox — see
the run lifecycle); `useInit` awaits that commit before re-staging so a slow
(retrying) commit can't let the re-stage drop the run from recents. Execution
itself is the `time === 0` effect in `useInit`, which refuses unless the build
is live (not `viewing`, `staged` or in prestart). There is deliberately **no
keyboard shortcut** for running a build: an undiscoverable global "R" key once
re-committed a running free-play run under a fresh id, committed reviewed mazes,
and fired from text inputs, so it was removed rather than patched. Picking a
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
watched stays up, its row reads "viewing". Play stages a fresh board when you
want one. Its window doesn't pause either: reviewing a past maze keeps the live
countdown in the HUD's Play slot alongside the reset button, and reset there
clears the attempt while staying on the reviewed maze (the input hooks gate on
`viewing`, so the ticking clock never makes a reviewed board editable). Should
the window expire mid-review, the board hands back to the build (restored from
the local record via `pendingFreePlay`, the one read that ignores the deadline)
and it executes normally — committed, runner released. `useClock`/`RunClock` run
the 60s/animation timing; `verdict.ts` computes the result.

## Push notifications

The client half (`client/util/push.ts`, `public/sw.js`) is described with the
server half in `server/CLAUDE.md`, since the two only make sense together.
