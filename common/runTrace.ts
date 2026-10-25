import type { Point } from "./types.ts";

// The edit trace of a ranked attempt: how the maze was built, recorded for
// solver review and never shown in the app. The client derives edits by diffing
// each maze it saves against the previous one (`diffMaze`), and every
// `updateRun` carries the events not yet confirmed; the server appends each
// batch to `run.trace` with its own receipt time (db/run.ts,
// `updateCurrentRun`). Client times are AGES (ms between the edit and the
// send), so no client clock origin is trusted or needed: an edit happened at
// about the batch's server time minus its age, and a log written after the fact
// can't pass as a live build without being sent live.
//
// An event is `[i, age, op, x, y]`, or `[i, age, "m", x, y, toX, toY]` for a
// move. `i` counts edits within the page (`p` names the page), so a batch
// resent after a lost response duplicates events with the same `(p, i)`; the
// reader dedupes on that pair.
//   p — piece placed
//   d — piece removed
//   m — piece moved from (x, y) to (toX, toY)
//   u — piece upgraded to a thunder in place
export type TraceOp = "p" | "d" | "m" | "u";

export type TraceEdit =
  | [op: "p" | "d" | "u", x: number, y: number]
  | [op: "m", x: number, y: number, toX: number, toY: number];

export type TraceEvent = [i: number, age: number, ...TraceEdit];

export type TraceBatch = { p: string; e: TraceEvent[] };

// Events per batch the server accepts; a 60s build never comes near it.
export const TRACE_BATCH_MAX = 400;

type Piece = Point & { thunder?: boolean };

const cell = (b: Point) => `${b.x},${b.y}`;

// The edits that turn `before` into `after`. Every board change is one gesture
// (a placement, delete, move or tap-upgrade), so a single removal paired with a
// single addition of the same kind reads as a move; anything else is reported
// piece by piece.
export const diffMaze = (
  before: readonly Piece[],
  after: readonly Piece[],
): TraceEdit[] => {
  const was = new Map(before.map((b) => [cell(b), b]));
  const now = new Map(after.map((b) => [cell(b), b]));
  const removed = before.filter((b) => !now.has(cell(b)));
  const added = after.filter((b) => !was.has(cell(b)));
  const edits: TraceEdit[] = [];
  for (const b of after) {
    const prev = was.get(cell(b));
    if (prev && !prev.thunder && b.thunder) edits.push(["u", b.x, b.y]);
    else if (prev && !!prev.thunder !== !!b.thunder) {
      edits.push(["d", b.x, b.y], ["p", b.x, b.y]);
    }
  }
  if (
    removed.length === 1 && added.length === 1 &&
    !!removed[0].thunder === !!added[0].thunder
  ) {
    edits.push(["m", removed[0].x, removed[0].y, added[0].x, added[0].y]);
  } else {
    for (const b of removed) edits.push(["d", b.x, b.y]);
    for (const b of added) edits.push(["p", b.x, b.y]);
  }
  return edits;
};
