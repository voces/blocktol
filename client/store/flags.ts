import { computed, signal } from "@preact/signals";
import type { Point } from "../../common/types.ts";
import { api } from "../api.ts";
import { flagWrites } from "./flagWrites.ts";

// Flags: the splits tape's manual checkpoints (see common/splits.ts). A flag
// belongs to the BOARD, not to a run, so the store is keyed by iteration and
// mirrors what the server holds for this player. Board responses (getBoard, and
// so boot / dayView) carry their flags, so nothing here fetches; it folds those
// in and writes edits back.

const NONE: readonly Point[] = [];

const byIteration = signal<ReadonlyMap<number, readonly Point[]>>(new Map());

export const flagsFor = (iteration: number | undefined) =>
  iteration === undefined ? NONE : byIteration.value.get(iteration) ?? NONE;

const put = (iteration: number, flags: readonly Point[]) => {
  const next = new Map(byIteration.value);
  next.set(iteration, flags);
  byIteration.value = next;
};

const writes = flagWrites(
  (iteration) => byIteration.peek().get(iteration) ?? NONE,
  put,
  (iteration, flags) =>
    api.setFlags({ iteration, flags: flags.map(({ x, y }) => ({ x, y })) })
      .then((r) => !(r && "error" in r)),
);

// A board response produced before an in-flight write (a re-stage racing the
// save) would fold the OLD set over the player's edit, so ingestion steps aside
// until every write settles.
api.addEventListener("getBoard", (board) => {
  if ("incomplete" in board || writes.saving(board.iteration)) return;
  put(board.iteration, board.flags);
});

/**
 * Replace this board's flags, optimistically. The write is an absolute upsert
 * of the whole set and `setFlags` is RETRYABLE, so a burst of edits is
 * last-write-wins and a dropped connection retries harmlessly. If the newest
 * write is rejected the board rolls back to the last confirmed set (see
 * flagWrites).
 */
export const saveFlags = (iteration: number, flags: readonly Point[]) => {
  writes.save(iteration, flags);
};

// Placement is ARMED explicitly, not implied by the panel being open: a bare
// tap is ambiguous (inspecting a thunder's radius vs. dropping a flag). The
// footer's "Add flag" arms it and Done exits.
export const flagsArmed = signal(false);

// The mark a tape row is hovering, as the board rectangle to ring: a thunder is
// 2x2, a flag or the checkpoint one cell. A signal for pointer-frequency state,
// as in Game/interaction.ts.
export const hoveredSplit = signal<
  { x: number; y: number; size: number } | undefined
>(undefined);

// The flags the run being reviewed crosses, as "x,y" keys (see flagKey). The
// board draws a flag the runner misses as a dashed outline. Written by the
// splits panel. Undefined when no tape is up, which is also the board's cue to
// draw no flags (see `splitsShowing`).
export const liveFlags = signal<ReadonlySet<string> | undefined>(undefined);

// Is the splits tape up? Derived from `liveFlags` so the two can't disagree.
// The board draws flags exactly when the tape is there to read them, never on a
// board being built on.
export const splitsShowing = computed(() => liveFlags.value !== undefined);

export const flagKey = (flag: Point) => `${flag.x},${flag.y}`;
