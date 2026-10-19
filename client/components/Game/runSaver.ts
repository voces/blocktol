import {
  diffMaze,
  TRACE_BATCH_MAX,
  type TraceEdit,
} from "../../../common/runTrace.ts";
import { Point } from "../../../common/types.ts";
import { api, MessageMap, withKeepalive } from "../../api.ts";

// Serialized persistence for a ranked build. Every save carries the FULL local
// maze, so only the newest matters: at most one updateRun is in flight and
// newer saves coalesce into `latest` (a trailing-edge queue of depth 1). Two
// in-flight requests could arrive out of order and persist a stale maze.
//
// Network failures retry the latest maze with backoff, silently; the board
// stays optimistic, and if the run starts before a save confirms,
// `flushRunSaver` comes back expired and `onExpired` snaps back to the accepted
// maze (see useInit). Server verdicts don't retry: an expired save can never
// land and a rejected one would be rejected again.

type LocalBlock = Point & { local?: boolean; thunder?: boolean };
type Save = { iteration: number; blocks: LocalBlock[] };
type UpdateRunSuccess = Exclude<MessageMap["updateRun"], { expired: boolean }>;

type Handlers = {
  // A confirmed save: `blocks` is the maze the server now holds (the new
  // revert target) and `run` its recomputed path for the board.
  onAccepted: (blocks: LocalBlock[], run: UpdateRunSuccess) => void;
  // The run's 60s window closed before the save landed — never persisted.
  onExpired: () => void;
  // The server rejected the maze (validation) and kept its previous state.
  onRejected: () => void;
};

let handlers: Handlers = {
  onAccepted: () => {},
  onExpired: () => {},
  onRejected: () => {},
};

// Wired by useInit on every render so the callbacks close over fresh state.
export const setRunSaverHandlers = (h: Handlers) => {
  handlers = h;
};

// Newest save not yet confirmed by the server.
let latest: Save | null = null;
let inFlight = false;
let attempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
// Trailing-debounce timer: a burst of placements collapses to one save. The
// delay is passed per save (`saveDebounce` in useInputEnd) and shrinks to 0 as
// the clock runs out. DEBOUNCE_MS is the ceiling and the default.
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
export const DEBOUNCE_MS = 2_000;
// Bumped by `resetRunSaver`; a response from an older generation is ignored so
// a late verdict can't mutate a board it no longer describes.
let gen = 0;

const BACKOFF_MS = [500, 1_000, 2_000, 4_000, 4_000, 4_000, 4_000, 4_000];

// The attempt's edit trace (common/runTrace.ts), recorded for solver review.
// Edits come from diffing each saved maze against `traceBase`, the maze the
// last edit left (or the one the server holds after a revert), and wait in
// `traceQueue` until a save carrying them is accepted. Every save sends the
// whole queue, so coalesced and retried saves lose nothing; a resend after a
// lost response repeats `(tracePage, i)`, which the reader dedupes.
type QueuedEdit = { i: number; at: number; edit: TraceEdit };
const tracePage = Math.random().toString(36).slice(2, 10) || "0";
let traceIndex = 0;
let tracing = false;
let traceBase: readonly LocalBlock[] = [];
let traceQueue: QueuedEdit[] = [];
// The maze the server last accepted, which a rejected save reverts the board
// to.
let acceptedMaze: readonly LocalBlock[] = [];

// A ranked attempt was staged (started or resumed) with `blocks` on the board,
// the maze the server holds. Edits queued from an earlier staging of the same
// attempt stay queued; `resetRunSaver` drops them when the attempt ends.
export const beginRunTrace = (blocks: readonly LocalBlock[]) => {
  tracing = true;
  traceBase = blocks;
  acceptedMaze = blocks;
};

const recordEdits = (blocks: readonly LocalBlock[]) => {
  if (!tracing) return;
  const at = performance.now();
  for (const edit of diffMaze(traceBase, blocks)) {
    traceQueue.push({ i: traceIndex++, at, edit });
  }
  traceBase = blocks;
};

// The queued edits as a batch, ages taken now.
const traceBatch = (sent: QueuedEdit[]) => {
  if (!tracing) return undefined;
  const now = performance.now();
  return {
    p: tracePage,
    e: sent.map(({ i, at, edit }) =>
      [i, Math.round(now - at), ...edit] as [number, number, ...TraceEdit]
    ),
  };
};

// Confirmed (or abandoned): drop the edits a save carried.
const dropSent = (sent: QueuedEdit[]) => {
  const last = sent.at(-1)?.i;
  if (last !== undefined) traceQueue = traceQueue.filter((q) => q.i > last);
};

const flush = () => {
  if (inFlight || !latest) return;
  const save = latest;
  const g = gen;
  const sent = traceQueue.slice(0, TRACE_BATCH_MAX);
  inFlight = true;
  api.updateRun({
    iteration: save.iteration,
    blocks: save.blocks,
    trace: traceBatch(sent),
  }).then(
    (r) => {
      if (g !== gen) return;
      inFlight = false;
      if ("error" in r) {
        // Revert only if nothing newer is queued; a newer save supersedes this
        // verdict.
        if (latest === save) {
          latest = null;
          // The board reverts to the accepted maze; the next edit diffs from
          // there.
          dropSent(sent);
          traceBase = acceptedMaze;
          handlers.onRejected();
        }
      } else if ("expired" in r) {
        // The window is closed: anything newer would expire too.
        latest = null;
        tracing = false;
        traceQueue = [];
        handlers.onExpired();
      } else {
        if (latest === save) latest = null;
        dropSent(sent);
        acceptedMaze = save.blocks;
        handlers.onAccepted(save.blocks, r);
      }
      attempt = 0;
      flush();
    },
  ).catch(() => {
    if (g !== gen) return;
    inFlight = false;
    // Network failure: retry the latest maze with backoff. When the schedule
    // runs dry, give up; the run-start flush reconciles the board. Report the
    // abandonment: it is the only signal for the block-revert incident.
    const delay = BACKOFF_MS[attempt++];
    if (delay === undefined) {
      api.reportClientError({
        message: "run save abandoned after retries",
        data: {
          iteration: save.iteration,
          blocks: save.blocks.length,
          attempt,
        },
      }).catch(() => {});
      return;
    }
    retryTimer = setTimeout(flush, delay);
  });
};

// Queue the build's current maze (replacing any older unconfirmed save); it
// also supersedes a pending retry backoff. `debounceMs` of 0 sends now.
export const saveRun = (save: Save, debounceMs = DEBOUNCE_MS) => {
  recordEdits(save.blocks);
  latest = save;
  clearTimeout(retryTimer);
  clearTimeout(debounceTimer);
  attempt = 0;
  if (debounceMs <= 0) flush();
  else debounceTimer = setTimeout(flush, debounceMs);
};

// Drop all pending work and ignore any in-flight response, on board changes
// (re-stage, run finished): a lingering retry would write a stale maze onto the
// next run.
export const resetRunSaver = () => {
  gen++;
  latest = null;
  tracing = false;
  traceQueue = [];
  inFlight = false;
  attempt = 0;
  clearTimeout(retryTimer);
  clearTimeout(debounceTimer);
};

// The run is starting: send the pending maze now, bypassing the debounce, so
// the server's row matches what executes. Do NOT cancel instead: that drops a
// debounced edit (tapping "Ready?" mid-build) and snaps the board back. The
// generation is kept so the response still lands: it updates the revert target,
// or comes back expired if the window already closed and onExpired snaps the
// board back. resetRunSaver at runFinish abandons anything still pending.
export const flushRunSaver = () => {
  clearTimeout(debounceTimer);
  clearTimeout(retryTimer);
  attempt = 0;
  flush();
};

// The page is being hidden (app switched, tab backgrounded, closed): send the
// pending maze NOW. A hidden page's timers are throttled or frozen, so a
// debounced edit would otherwise arrive only when the player returns, usually
// after the window closed. keepalive lets the request finish as the page goes.
// An in-flight save chains the newer maze on its answer as usual; a concurrent
// second could land out of order. (pagehide too: Safari can fire it before, or
// without, the visibility change.)
const flushOnHide = () => {
  if (!latest || inFlight) return;
  clearTimeout(debounceTimer);
  clearTimeout(retryTimer);
  attempt = 0;
  withKeepalive(flush);
};
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushOnHide();
  });
  globalThis.addEventListener("pagehide", flushOnHide);
}
