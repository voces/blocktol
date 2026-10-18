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
delay that ramps from 2s down to 0 over the final 10s (`saveDebounce`). At run
start `flushRunSaver` **sends** the pending maze immediately (rather than
reverting to the last confirmed one — that would drop a debounced edit the
player hasn't waited out, e.g. tapping "Ready?" mid-build); if the window has
already closed the flush comes back expired and `onExpired` snaps the board back
— blocks AND the run (`revertToSaved` recomputes it with `localRun`, so the
runner walks the maze the server holds). The saver also flushes immediately
(with `keepalive`) when the page is hidden or unloaded, since a hidden page's
debounce timer may not fire until the window has closed. **Free play** bypasses
the saver entirely: `freePlay.ts` mints the per-attempt `client_id`, mirrors the
maze to `localStorage` for reload-resume, and `commitFreePlay` fires once at
execution (through the commit outbox — see the run lifecycle); `useInit` awaits
that commit before re-staging so a slow (retrying) commit can't let the re-stage
drop the run from recents. Execution itself is the `time === 0` effect in
`useInit`, which refuses unless the build is live (not `viewing`, `staged` or in
prestart). There is deliberately **no keyboard shortcut** for running a build:
an undiscoverable global "R" key once re-committed a running free-play run under
a fresh id, committed reviewed mazes, and fired from text inputs, so it was
removed rather than patched. Picking a maze to review RELEASES the runner over
it (`viewMaze`'s `replay`, defaulting on — asking to see a maze means asking to
see it run; re-picking the row runs it again), which is also why `runFinish`
bails while `viewing`: a replay is not an attempt finishing and must not commit,
re-stage, or spend anything. The one caller that opts out is the review a
just-finished free-play run lands in, which would replay the run you were
already watching. A reviewed board stays inert to placement, but a hover (or, on
touch, a tap) still reveals a thunder's radius — the day's pieces and the
reviewed maze's alike, which is the point of studying a maze. Navigating away
mid-build (reviewing a maze, another day) deliberately does NOT abandon the
build — the record stays, and staging its board within the window resumes it. A
free-play run that FINISHES doesn't clear the board either: the re-stage still
runs (it refreshes the board's bests and recents), and the executed maze is then
overlaid back onto it as a review — the run you just watched stays up, its row
reads "viewing", and its splits are there to read. Play stages a fresh board
when you want one. Its window doesn't pause either: reviewing a past maze keeps
the live countdown in the HUD's Play slot alongside the reset button, and reset
there clears the attempt while staying on the reviewed maze (the input hooks
gate on `viewing`, so the ticking clock never makes a reviewed board editable).
Should the window expire mid-review, the board hands back to the build (restored
from the local record via `pendingFreePlay`, the one read that ignores the
deadline) and it executes normally — committed, runner released.
`useClock`/`RunClock` run the 60s/animation timing; `verdict.ts` computes the
result.

## Splits and flags

**Splits & flags (`Game/Splits.tsx`, `components/FlagLayer.tsx`,
`store/flags.ts`):** the tape above the runs list, rendered inside `.attempts`
so it scrolls with the list it describes. On desktop the dock and the runs are
one `.game__rail` spanning both grid rows (a separate dock row would take the
taller today card's height and leave a dead gap above the runs); the rail's
`--rail-gap` is also the tape's bottom margin, so the tape sits evenly between
the two. It appears only for **a run in free play** — one you're reviewing, or
the one currently animating
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
into a desktop drawer), this discloses in place (right, rotating down). **The
flags on the board come and go with the tape**, on the same condition — the
board draws them only while the panel is up, so a board you are BUILDING on
(free play or ranked) shows none. They are the tape's marks: one you can't read
a split off is just something in the way of the cells you're placing into. The
flags themselves still belong to the board and stay put across runs and reviews;
only their visibility rides along. Flag placement is explicitly **armed** from
the footer (with the board visible a bare tap is ambiguous — inspecting a
thunder's radius vs. dropping a flag); armed, the board dims behind a scrim, any
cell takes a flag, and a flag drags to move / taps to clear. The gesture mirrors
a BLOCK placement, down to the placing zoom and its delay: the flag appears
under the pointer the instant it lands, follows it, and is written on release —
at the cell its preview stood on, never a fresh mapping of the release point,
since the zoom animation is still moving the board's box under the finger (the
same reason `useInputEnd` commits `placingBlock` rather than re-reading the
pointer). `store/flags.ts` folds flags in from board responses, writes them back
optimistically, and carries the two board-facing signals (`liveFlags` — which
flags this run actually crosses, the rest drawing dashed as speculative; **unset
when no tape is up**, which is also what `splitsShowing` derives the board's
draw-them-at-all gate from, so the two can't drift — and `hoveredSplit`, the
mark a hovered row rings), the same signals-not-context split
`Game/interaction.ts` uses.

## Push notifications

The client half (`client/util/push.ts`, `public/sw.js`) is described with the
server half in `server/CLAUDE.md`, since the two only make sense together.
