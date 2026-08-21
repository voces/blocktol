import { computed, signal } from "@preact/signals";
import type { Point } from "../../common/types.ts";
import { api } from "../api.ts";

// Flags: the splits tape's manual checkpoints (see common/splits.ts). A flag
// belongs to the BOARD, not to a run — place one and every build of that maze is
// timed against it — so the store is keyed by iteration and mirrors what the
// server holds for this player. Boards arrive with their flags attached
// (getBoard, and so boot / dayView / the board loaders through it), so nothing
// here fetches; it folds in what a board response already carried and writes
// edits back.

const NONE: readonly Point[] = [];

const byIteration = signal<ReadonlyMap<number, readonly Point[]>>(new Map());

export const flagsFor = (iteration: number | undefined) =>
  iteration === undefined ? NONE : byIteration.value.get(iteration) ?? NONE;

const put = (iteration: number, flags: readonly Point[]) => {
  const next = new Map(byIteration.value);
  next.set(iteration, flags);
  byIteration.value = next;
};

// Iterations with a write in flight. A board response that was produced before
// that write (a re-stage racing the save) would otherwise fold the OLD set back
// over the edit the player just made, so ingestion steps aside until the write
// settles — at which point the local set and the server's agree anyway.
const saving = new Set<number>();

api.addEventListener("getBoard", (board) => {
  if ("incomplete" in board || saving.has(board.iteration)) return;
  put(board.iteration, board.flags);
});

/**
 * Replace this board's flags, optimistically. The write is an absolute-value
 * upsert of the whole set (and `setFlags` is in the client's RETRYABLE
 * allowlist), so a burst of edits is last-write-wins and a dropped connection
 * retries harmlessly. A rejected write rolls the board back to what the server
 * still holds, the way the runs panel's pin toggle does.
 */
export const saveFlags = (iteration: number, flags: readonly Point[]) => {
  const previous = flagsFor(iteration);
  put(iteration, flags);
  saving.add(iteration);
  const done = () => saving.delete(iteration);
  api.setFlags({ iteration, flags: flags.map(({ x, y }) => ({ x, y })) })
    .then((r) => {
      done();
      if (r && "error" in r) put(iteration, previous);
    })
    .catch(() => {
      done();
      put(iteration, previous);
    });
};

// Placement is explicitly ARMED rather than implied by the panel being open:
// with the board visible a bare tap is ambiguous (inspecting a thunder's radius
// vs. dropping a flag), so the footer's "Add flag" arms it and Done exits.
export const flagsArmed = signal(false);

// The mark a tape row is hovering, as the board rectangle to ring: a thunder is
// a 2x2 piece, a flag or the checkpoint a single cell. Pointer-frequency UI
// state, so a signal — the board redraws, the panel doesn't (same reasoning as
// Game/interaction.ts).
export const hoveredSplit = signal<
  { x: number; y: number; size: number } | undefined
>(undefined);

// The flags the run being reviewed actually crosses, as "x,y" keys. A flag the
// runner misses reports nothing, and the board draws it as a dashed outline —
// a speculative mark waiting for a build that routes past it. Written by the
// splits panel, which is what knows. Undefined when no tape is up, which is
// also the board's cue that there are no flags to draw at all (see
// `splitsShowing`).
export const liveFlags = signal<ReadonlySet<string> | undefined>(undefined);

// Is the splits tape up? Derived from `liveFlags` rather than tracked beside it
// so the two can never disagree: the panel sets that one signal, and the board
// reads this. Flags are the tape's marks, so the board draws them exactly when
// the tape is there to read them off — never on a board you are building on.
export const splitsShowing = computed(() => liveFlags.value !== undefined);

export const flagKey = (flag: Point) => `${flag.x},${flag.y}`;
