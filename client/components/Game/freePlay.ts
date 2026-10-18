// Free play runs on the client until it executes: no startRun/updateRun. The
// 60s window is enforced locally, the in-progress state is mirrored to
// localStorage so a reload resumes, and the server is touched once, at commit,
// by a single idempotent INSERT keyed by a per-attempt clientId (see
// insertFreePlayRun in server/db/run.ts). This module owns that id, the
// local-resume record and the commit outbox.
//
// Trusting the client is safe: free play never feeds ELO, a player's own today
// is locked until its three ranked attempts are spent (util/boardAccess.ts),
// and the server recomputes the time from the submitted maze. Only the 60s
// build budget is taken on trust.

import { Point } from "../../../common/types.ts";
import { api } from "../../api.ts";
import { getId } from "../../util/id.ts";
import { storage } from "../../util/storage.ts";
import { getTimeZone } from "../../util/timeZone.ts";

const KEY = "blocktol.freeplay";

// A stored in-progress attempt: iteration, idempotency id, local deadline (ms
// epoch) and the maze built so far.
export type FreePlayState = {
  iteration: number;
  clientId: string;
  deadline: number;
  blocks: (Point & { thunder?: boolean })[];
};

// The id the current attempt commits under (module state: one active game),
// stored by persistFreePlay so a resumed attempt keeps it.
let clientId: string | null = null;

// Begin a free-play attempt (its first placement): mint the idempotency id.
export const beginFreePlay = () => {
  clientId = crypto.randomUUID();
};

// The id for the run now committing; mints one if unset so the write lands.
export const freePlayClientId = () => (clientId ??= crypto.randomUUID());

// Mirror the in-progress attempt so a reload resumes it. Called on every edit.
// Best-effort: a storage failure means no resume, never a broken build.
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

// The in-flight commit for the attempt that just executed. runFinish awaits it
// before re-staging, so a slow (retrying) commit can't let getBoard return
// recents that predate the run. Resolved by default (an empty attempt commits
// nothing).
let pendingCommit: Promise<unknown> = Promise.resolve();

export const setPendingCommit = (p: Promise<unknown>) => {
  // Swallowed so awaiting never throws; the caller reports the failure.
  pendingCommit = p.catch(() => {});
};

export const awaitPendingCommit = () => pendingCommit;

// The commit outbox. The in-progress record is dropped at execution, but the
// run isn't the server's until commitRun LANDS, and a commit can fail outright
// (a deploy restart outlasting the api client's retries, a reload
// mid-animation). Each executed maze is parked here with its client id BEFORE
// the send and removed only once the server has answered for it. What's left is
// re-sent at the next boot and on `online`. Replay is safe: the INSERT is
// idempotent on client id, so a commit that landed but lost its answer is a
// no-op.
//
// At most ONE run per board per player: the best. Only the best can move the
// PB field, the lost-top notice or the Discord top build, so a worse run isn't
// worth re-sending. Every run is still SENT at execution; only the retry queue
// is thinned. A tie keeps the earlier run.
//
// Entries older than OUTBOX_MAX_AGE_MS are dropped; OUTBOX_MAX is a storage
// backstop.
const OUTBOX_KEY = "blocktol.freeplay.outbox";
const OUTBOX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const OUTBOX_MAX = 50;

type OutboxEntry = {
  iteration: number;
  clientId: string;
  blocks: (Point & { thunder?: boolean })[];
  // The run's local time, so the queue can keep only the best per board.
  time: number;
  // The device id the run was built under. A queued run is sent only as its
  // own player: after a move-device link swapped the id, the entry waits (and
  // ages out) rather than landing on another player's board.
  user: string;
  at: number;
  // The zone the run was built in, for the server's board gate. Captured at
  // execution so a replay after travel is judged where it was played. Absent on
  // entries from an older bundle; the server reads that as the westernmost
  // zone.
  timeZone?: string;
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

// A server 5xx (`{ error, status: 500 }`, the DB write failed) is worth
// retrying; any other error is a verdict on the maze (illegal, unauthenticated)
// that a replay would only hear again.
const settled = (r: CommitResult) =>
  !("error" in r) || !("status" in r) || !(Number(r.status) >= 500);

const send = (entry: OutboxEntry): Promise<CommitResult> => {
  sending.add(entry.clientId);
  return api.commitRun({
    iteration: entry.iteration,
    blocks: entry.blocks,
    clientId: entry.clientId,
    timeZone: entry.timeZone,
  }).then((r) => {
    if (settled(r)) dropFromOutbox(entry.clientId);
    return r;
  }).finally(() => sending.delete(entry.clientId));
};

// Queue `entry` unless the same player already has an equal-or-better run
// queued for that board; a worse queued run is replaced (see OUTBOX_KEY).
const enqueue = (entry: OutboxEntry) => {
  const queued = readOutbox().filter((e) => e.clientId !== entry.clientId);
  const sameBoard = (e: OutboxEntry) =>
    e.iteration === entry.iteration && e.user === entry.user;
  if (queued.some((e) => sameBoard(e) && e.time >= entry.time)) return;
  writeOutbox([...queued.filter((e) => !sameBoard(e)), entry]);
};

// Commit the attempt that just executed: queue it (if it's the best waiting for
// its board), then send it. Resolves/rejects like commitRun; an unanswered
// queued run stays for flushFreePlayOutbox. A landed commit also drains the
// backlog.
export const commitFreePlay = (
  iteration: number,
  blocks: (Point & { thunder?: boolean })[],
  time: number,
): Promise<CommitResult> => {
  const entry: OutboxEntry = {
    iteration,
    clientId: freePlayClientId(),
    blocks,
    time,
    user: getId(),
    at: Date.now(),
    timeZone: getTimeZone(),
  };
  enqueue(entry);
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

// Forget every queued commit (account erasure: they are the erased player's).
export const clearFreePlayOutbox = () => writeOutbox([]);

// Boot wiring: drain earlier sessions' leftovers after the boot requests have
// had the wire to themselves, and again on `online`.
export const installFreePlayOutbox = () => {
  setTimeout(() => flushFreePlayOutbox(), 3_000);
  globalThis.addEventListener("online", () => flushFreePlayOutbox());
};

// Drop the local record and the id: at execution (the outbox holds the run from
// there) and on re-stage/abandon.
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

// A resumable attempt for `iteration`, or null: same iteration, window still
// open, non-empty. Adopts the stored id so the commit is idempotent under it. A
// non-matching record is KEPT, not deleted: navigating away doesn't abandon the
// build, and coming back within its window resumes.
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
// The expiry hand-off (a build executing while its owner reviews another maze)
// needs the record just as the deadline check starts failing. Adopts the stored
// id like a resume, so the commit lands under the attempt's own key.
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
