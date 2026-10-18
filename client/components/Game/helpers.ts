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
 * Whether the maze formed by `blocks` (plus an optional candidate at (x, y))
 * still leaves the runner a route. Existence only (hover and drag validity), on
 * the shared solver, whose memo makes a pointer sweep cheap. A throw (an
 * overlap the caller's pre-checks missed, the boot board's off-board checkpoint
 * sentinel) reads as unsolvable.
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
 * Compute the runner's path and time client-side on the same shared
 * `cachedSolver`/`PathSolver` the server validates with, so the preview matches
 * the server's time, down to how equal-length ties break (which matters near
 * thunders, where duration depends on geometry). `blocks` is the whole board:
 * fixed pieces plus the player's, `local` marking the player's. Returns
 * undefined for a momentarily path-less state (mid-drag illegal placement); the
 * caller keeps the prior run then.
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
 * Order-independent key for a maze, so a stored run and the board compare equal
 * regardless of piece order. Used to merge the runs panel's rows, flag the row
 * being reviewed, and tell the splits panel whether the board IS the reference
 * best.
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
 * Whether a client point falls on the border band (the outer one-unit ring of
 * the 20x20 viewBox). Touches there must not place or zoom, so the HUD controls
 * drawn on the border get their own taps.
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
 * block's cells).
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
 * checkpoint, overlapping another block, or blocking the only path. `origin` is
 * temporarily vacated from the grid for the overlap test, so a block can move
 * over where it sits; the solver answers reachability with `origin` relocated.
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

/**
 * The brick/power chips for a maze: the board's full budget minus what the
 * maze holds. Derive the counts from this, never step or store them (see
 * `useGameState`): a stepped refund can survive a removal that a stale write
 * put back, handing out a brick the budget never had, which the server rejects
 * at commit ("too many blocks"), losing the run.
 *
 * A total of -1 means no budget is loaded, and the chip stays hidden.
 */
export const mazeBudget = (
  maze: ReadonlyArray<{ thunder?: boolean }>,
  totals: { bricks: number; power: number },
) => ({
  bricks: totals.bricks < 0 ? -1 : Math.max(0, totals.bricks - maze.length),
  power: totals.power < 0
    ? -1
    : Math.max(0, totals.power - maze.filter((b) => b.thunder).length),
});
