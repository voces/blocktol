import { is } from "../../../common/typeguards.ts";
import { offsets } from "../../../common/constants.ts";
import {
  cachedSolver,
  newGrid,
  pathDuration,
  Slow,
} from "../../../common/pathing.ts";
import { Point } from "../../../common/types.ts";

export type LocalRun = { path: Point[]; duration: number; slows: Slow[] };

export type BoardBlocks = ReadonlyArray<
  Point & { thunder?: boolean; local?: boolean }
>;

/**
 * Whether the maze formed by `blocks` (plus an optional candidate block at
 * (x, y)) still leaves the runner a route. Existence-only — hover and drag
 * validity — on the same shared solver the preview and the server run, whose
 * memo and one-added shortcut make a pointer sweep cheap. A throw (overlap the
 * caller's pre-checks missed, the boot board's off-board checkpoint sentinel)
 * reads as unsolvable.
 */
export const solvable = (
  blocks: BoardBlocks,
  checkpoint: Point,
  candidate?: Point,
) => {
  try {
    return !!cachedSolver(blocks.filter((b) => !b.local), checkpoint).solve([
      ...blocks.filter((b) => b.local),
      ...(candidate ? [candidate] : []),
    ]);
  } catch {
    return false;
  }
};

/**
 * Compute the runner's path and time client-side with the same engine — the
 * shared `cachedSolver`/`PathSolver` — the server validates and times with, so
 * the preview equals exactly what the server would accept, down to how
 * equal-length ties break (which matters near thunders, where duration depends
 * on geometry). This is what lets a build update the board with no round trip:
 * free play never contacts the server mid-build at all, and a ranked build
 * shows its path instantly while its save is debounced. `blocks` is the whole
 * board — the iteration's fixed pieces plus the player's, `local` marking the
 * player's, thunders flagged. Returns undefined for a momentarily path-less
 * state (mid-drag illegal placement); the caller keeps the prior run then.
 */
export const localRun = (
  blocks: BoardBlocks,
  checkpoint: Point,
): LocalRun | undefined => {
  let path: Point[] | undefined;
  try {
    path = cachedSolver(blocks.filter((b) => !b.local), checkpoint)
      .solve(blocks.filter((b) => b.local));
  } catch {
    return undefined;
  }
  if (!path) return undefined;
  const [duration, slows] = pathDuration(
    path,
    blocks.filter((b) => b.thunder),
  );
  return { path, duration, slows };
};

/**
 * Order-independent key for a maze, so two lists that hold the same pieces in a
 * different order (a stored run vs. what's on the board) compare equal. Used to
 * merge the runs panel's rows, to flag the row currently being reviewed, and by
 * the splits panel to tell whether the maze on the board IS the reference best.
 */
export const mazeKey = (
  maze: ReadonlyArray<{ x: number; y: number; thunder?: boolean }>,
) =>
  JSON.stringify(
    [...maze]
      .map((b) => [b.x, b.y, b.thunder ? 1 : 0])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]),
  );

export const isTouchSource = is.object({
  sourceCapabilities: is.object({ firesTouchEvents: is.const(true) }),
});

export const randomColor = () =>
  `hsl(${Math.random() * 360} 100% var(--brightness))`;

/**
 * Whether a client point falls on the board's border/wall band (the outer
 * one-unit ring of the 20x20 viewBox) rather than the interior play area.
 * Touches there should not trigger board interaction (placing blocks, zoom),
 * leaving the HUD controls drawn on the border free to handle their own taps.
 */
export const isBorderPoint = (
  svg: SVGSVGElement | null,
  clientX: number,
  clientY: number,
) => {
  if (!svg) return false;
  const box = svg.getBoundingClientRect();
  const x = (clientX - box.x) / box.width * 20;
  const y = (clientY - box.y) / box.height * 20;
  return x < 1 || x > 19 || y < 1 || y > 19;
};

/**
 * Rebuild the pathing grid in place from `blocks` (walls + checkpoint + each
 * block's cells). Mirrors the grid maintenance the place/remove paths perform.
 */
export const rebuildGrid = (
  grid: boolean[][],
  checkpoint: Point,
  blocks: ReadonlyArray<Point>,
) => {
  grid.splice(0, Infinity, ...newGrid());
  grid[checkpoint.y + 0.5][checkpoint.x + 0.5] = true;
  for (const { x, y } of blocks) {
    offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = true);
  }
};

/**
 * Whether dropping the block `origin` at (x, y) is not allowed: adjacent to the
 * checkpoint, overlapping another block, or blocking the only path. The grid
 * (with `origin` temporarily vacated) answers the overlap question, so a block
 * can be dragged over/through where it currently sits; the shared solver
 * answers reachability for the maze with `origin` relocated.
 */
export const isInvalidMove = (
  grid: boolean[][],
  blocks: BoardBlocks,
  checkpoint: Point,
  origin: Point,
  x: number,
  y: number,
) => {
  if (Math.abs(checkpoint.x - x) + Math.abs(checkpoint.y - y) <= 1) return true;

  offsets.forEach(([xd, yd]) => grid[origin.y + yd][origin.x + xd] = false);
  const invalid = offsets.some(([xd, yd]) => grid[y + yd][x + xd]) ||
    !solvable(blocks.filter((b) => b !== origin), checkpoint, { x, y });
  offsets.forEach(([xd, yd]) => grid[origin.y + yd][origin.x + xd] = true);
  return invalid;
};
