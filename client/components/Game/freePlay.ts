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
import { api } from "../../api.ts";
import { getId } from "../../util/id.ts";
import { storage } from "../../util/storage.ts";

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
    storage.setItem(
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

// The commit outbox. The in-progress record above is dropped the moment a run
// executes (it must not resume), but the run isn't the server's until commitRun
// LANDS — and a commit can fail outright: the api client's retries span a few
// seconds, a deploy's restart or a dead connection can outlast them, and a
// reload mid-animation abandons the request. Each executed maze is therefore
// parked here, with its client id, BEFORE the commit is sent, and removed only
// once the server has answered for it. What's left is re-sent at the next boot
// and whenever the browser comes back online. Replaying is safe by
// construction: the server's INSERT is idempotent on client id, so a commit that
// did land but whose answer was lost is a no-op the second time.
const OUTBOX_KEY = "blocktol.freeplay.outbox";
// Bounds, so a device that is never online again can't grow this forever:
// a week-old run is not worth resurrecting, and twenty unsent runs is far past
// any honest backlog.
const OUTBOX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const OUTBOX_MAX = 20;

type OutboxEntry = {
  iteration: number;
  clientId: string;
  blocks: (Point & { thunder?: boolean })[];
  // The device id the run was built under. A queued run is only ever sent as
  // its own player — after a move-device link swapped this device's id, the
  // entry waits (and ages out) rather than landing on someone else's board.
  user: string;
  at: number;
};

const readOutbox = (): OutboxEntry[] => {
  try {
    const parsed = JSON.parse(storage.getItem(OUTBOX_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeOutbox = (entries: OutboxEntry[]) => {
  if (entries.length) {
    storage.setItem(OUTBOX_KEY, JSON.stringify(entries.slice(-OUTBOX_MAX)));
  } else storage.removeItem(OUTBOX_KEY);
};

const dropFromOutbox = (clientId: string) =>
  writeOutbox(readOutbox().filter((e) => e.clientId !== clientId));

// Client ids with a commit on the wire, so a flush never doubles one up.
const sending = new Set<string>();

type CommitResult = Awaited<ReturnType<typeof api.commitRun>>;

// A server 5xx (`{ error, status: 500 }` — the commit's DB write failed) is
// worth trying again later; any other error is a verdict on the maze (illegal,
// unauthenticated) that a replay would only hear again.
const settled = (r: CommitResult) =>
  !("error" in r) || !("status" in r) || !(Number(r.status) >= 500);

const send = (entry: OutboxEntry): Promise<CommitResult> => {
  sending.add(entry.clientId);
  return api.commitRun({
    iteration: entry.iteration,
    blocks: entry.blocks,
    clientId: entry.clientId,
  }).then((r) => {
    if (settled(r)) dropFromOutbox(entry.clientId);
    return r;
  }).finally(() => sending.delete(entry.clientId));
};

// Commit the attempt that just executed: park it in the outbox, then send it.
// Resolves/rejects like a plain commitRun; whatever the outcome, an unanswered
// run stays queued for flushFreePlayOutbox. A landed commit also drains any
// backlog, since the connection is evidently back.
export const commitFreePlay = (
  iteration: number,
  blocks: (Point & { thunder?: boolean })[],
): Promise<CommitResult> => {
  const entry: OutboxEntry = {
    iteration,
    clientId: freePlayClientId(),
    blocks,
    user: getId(),
    at: Date.now(),
  };
  writeOutbox([
    ...readOutbox().filter((e) => e.clientId !== entry.clientId),
    entry,
  ]);
  const p = send(entry);
  p.then((r) => {
    if (settled(r)) flushFreePlayOutbox();
  }).catch(() => {});
  return p;
};

// Re-send every queued commit, oldest first, stopping at the first one that
// still can't land (the rest would fail the same way).
let flushing = false;
export const flushFreePlayOutbox = async () => {
  if (flushing) return;
  flushing = true;
  try {
    const now = Date.now();
    const fresh = readOutbox().filter((e) => now - e.at < OUTBOX_MAX_AGE_MS);
    writeOutbox(fresh);
    for (const entry of fresh) {
      if (sending.has(entry.clientId) || entry.user !== getId()) continue;
      try {
        if (!settled(await send(entry))) break;
      } catch {
        break;
      }
    }
  } finally {
    flushing = false;
  }
};

// Forget every queued commit (account erasure — they're the erased player's).
export const clearFreePlayOutbox = () => writeOutbox([]);

// Boot wiring: drain what an earlier session left once the boot requests have
// had the wire to themselves, and again whenever connectivity returns.
export const installFreePlayOutbox = () => {
  setTimeout(() => flushFreePlayOutbox(), 3_000);
  globalThis.addEventListener("online", () => flushFreePlayOutbox());
};

// Drop the local record and the id. Called at commit (the run is the server's
// now) and on re-stage/abandon (a fresh board must not resume the old build).
export const clearFreePlay = () => {
  clientId = null;
  try {
    storage.removeItem(KEY);
  } catch { /* ignore */ }
};

// The raw stored record, or null when absent/unreadable/corrupt.
const readRecord = (): FreePlayState | null => {
  let raw: string | null;
  try {
    raw = storage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
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
  const state = readRecord();
  if (
    !state || state.iteration !== iteration || !(state.deadline > now) ||
    !Array.isArray(state.blocks) || state.blocks.length === 0
  ) {
    return null;
  }
  clientId = state.clientId;
  return state;
};

// The stored attempt for `iteration` REGARDLESS of its window (non-empty only).
// The expiry hand-off — a build executing while its owner reviews another maze —
// needs the record at exactly the moment the deadline check starts failing, so
// this skips it. Adopts the stored id like a resume does, so the commit still
// lands under the attempt's own idempotency key.
export const pendingFreePlay = (iteration: number): FreePlayState | null => {
  const state = readRecord();
  if (
    !state || state.iteration !== iteration ||
    !Array.isArray(state.blocks) || state.blocks.length === 0
  ) {
    return null;
  }
  clientId = state.clientId;
  return state;
};
