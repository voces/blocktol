// Free play runs entirely on the client until it executes. There is no
// startRun/updateRun round trip: the maze is built and the 60s window is enforced
// locally, the in-progress state is mirrored to localStorage so a reload resumes,
// and the server is touched exactly once — at commit — as a single idempotent
// INSERT keyed by a per-attempt clientId (see server db/run.ts insertFreePlayRun).
// This module owns that per-attempt id and the local-resume record.
//
// Trusting the client here is deliberate and safe: free play only unlocks after
// the day's three ranked attempts are spent, it never feeds the ELO/ranked field,
// and the server still recomputes the time from the submitted maze — only the 60s
// build budget is taken on trust, which a determined player could evade offline
// anyway.

import { Point } from "../../../common/types.ts";

const KEY = "blocktol.freeplay";

// A stored in-progress attempt: the day it's on, its idempotency id, the locally
// enforced deadline (ms epoch), and the maze built so far.
export type FreePlayState = {
  iteration: number;
  clientId: string;
  deadline: number;
  blocks: (Point & { thunder?: boolean })[];
};

// The id the current attempt commits under. Held in module state (one active
// game) and mirrored into every persist() so a resumed attempt keeps the same id.
let clientId: string | null = null;

// Begin a free-play attempt (its first placement): mint the idempotency id.
export const beginFreePlay = () => {
  clientId = crypto.randomUUID();
};

// The id for the run now committing; mints one if somehow unset so the write
// still lands.
export const freePlayClientId = () => (clientId ??= crypto.randomUUID());

// Mirror the in-progress attempt so a reload resumes it. Called on every edit —
// cheap (a small JSON blob) and synchronous. Best-effort: a storage failure just
// means no resume, never a broken build.
export const persistFreePlay = (
  iteration: number,
  deadline: number,
  blocks: (Point & { thunder?: boolean; local?: boolean })[],
) => {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify(
        {
          iteration,
          clientId: freePlayClientId(),
          deadline,
          blocks: blocks.map((b) =>
            b.thunder ? { x: b.x, y: b.y, thunder: true } : { x: b.x, y: b.y }
          ),
        } satisfies FreePlayState,
      ),
    );
  } catch { /* storage unavailable/full — resume is best-effort */ }
};

// The in-flight commit for the attempt that just executed. runFinish awaits this
// before re-staging, so a slow commit — e.g. one retrying its way across a deploy
// that dropped the connection — can't let the re-stage's getBoard fetch a recents
// list that predates the run and drop it from the panel. Defaults resolved (an
// empty attempt commits nothing).
let pendingCommit: Promise<unknown> = Promise.resolve();

export const setPendingCommit = (p: Promise<unknown>) => {
  // Swallow rejection here so awaiting it never throws; the caller reports the
  // ultimate failure separately.
  pendingCommit = p.catch(() => {});
};

export const awaitPendingCommit = () => pendingCommit;

// Drop the local record and the id. Called at commit (the run is the server's
// now) and on re-stage/abandon (a fresh board must not resume the old build).
export const clearFreePlay = () => {
  clientId = null;
  try {
    localStorage.removeItem(KEY);
  } catch { /* ignore */ }
};

// A resumable attempt for `iteration`, or null: present, same day, its window
// still open, and non-empty. Adopts the stored id so the resumed attempt commits
// idempotently under it. A mismatched/expired record is discarded so it can't
// resurrect onto the wrong board. Deliberately KEPT when it merely doesn't match
// the board being staged: navigating away (another day, a reviewed maze) doesn't
// abandon the build — its window keeps running, and coming back within it
// resumes.
export const resumableFreePlay = (
  iteration: number,
  now: number,
): FreePlayState | null => {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let state: FreePlayState;
  try {
    state = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    state.iteration !== iteration || !(state.deadline > now) ||
    !Array.isArray(state.blocks) || state.blocks.length === 0
  ) {
    return null;
  }
  clientId = state.clientId;
  return state;
};
