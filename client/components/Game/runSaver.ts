import { Point } from "../../../common/types.ts";
import { api, MessageMap } from "../../api.ts";

// Serialized persistence for the in-progress build. Every save carries the
// FULL local maze, so only the newest state matters: at most one updateRun is
// in flight, and anything newer coalesces into `latest` (a trailing-edge queue
// of depth 1). That serialization is what makes saves safe — two in-flight
// requests could arrive out of order and persist a stale maze — and it makes a
// double-enqueue from the same edit harmless.
//
// Network failures retry the latest maze with backoff, silently: the board
// stays optimistic, and if the run starts before a save confirms, finalize()
// tells the caller to snap back to the accepted maze (see useInit). Server
// verdicts don't retry — an expired save can never land (the window is
// closed), and a rejected one would be rejected again.

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
let retryTimer = -1;
// Bumped by reset/finalize; an in-flight response from a previous generation
// is ignored so a late verdict can't mutate a board it no longer describes.
let gen = 0;

const BACKOFF_MS = [500, 1_000, 2_000, 4_000, 4_000, 4_000, 4_000, 4_000];

const flush = () => {
  if (inFlight || !latest) return;
  const save = latest;
  const g = gen;
  inFlight = true;
  api.updateRun({ iteration: save.iteration, blocks: save.blocks }).then(
    (r) => {
      if (g !== gen) return;
      inFlight = false;
      if ("error" in r) {
        // Only revert if nothing newer is queued — a newer save supersedes
        // this verdict and will settle the board itself.
        if (latest === save) {
          latest = null;
          handlers.onRejected();
        }
      } else if ("expired" in r) {
        // The window is closed: anything newer would expire too.
        latest = null;
        handlers.onExpired();
      } else {
        if (latest === save) latest = null;
        handlers.onAccepted(save.blocks, r);
      }
      attempt = 0;
      flush();
    },
  ).catch(() => {
    if (g !== gen) return;
    inFlight = false;
    // Network failure: retry the latest maze with backoff. After the schedule
    // runs dry, give up — the board stays optimistic and finalize() reconciles
    // it at run start (the visible "blocks reverted"). Report that abandonment
    // so these recovery failures are no longer invisible: this is exactly the
    // block-revert incident we otherwise had no signal for.
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

// Queue the build's current maze for persistence (replacing any older
// unconfirmed save). A fresh user action also supersedes a pending retry
// backoff — send now.
export const saveRun = (save: Save) => {
  latest = save;
  clearTimeout(retryTimer);
  attempt = 0;
  flush();
};

// Drop all pending work and ignore any in-flight response. For board changes
// (re-stage, run finished) where old saves must not touch the new board — a
// lingering retry would otherwise write a stale maze onto the next run.
export const resetRunSaver = () => {
  gen++;
  latest = null;
  inFlight = false;
  attempt = 0;
  clearTimeout(retryTimer);
};

// The run is starting: nothing unconfirmed can make it in anymore. Cancels
// everything and reports whether an unconfirmed save existed — if so, the
// caller snaps the board back to the accepted maze so what animates matches
// what the server executes.
export const finalizeRunSaver = () => {
  const unconfirmed = latest !== null || inFlight;
  resetRunSaver();
  return unconfirmed;
};
