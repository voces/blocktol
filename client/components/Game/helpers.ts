import { is } from "../../../common/typeguards.ts";
import { offsets } from "../../../common/constants.ts";
import {
  cachedSolver,
  findPath,
  newGrid,
  pathDuration,
  Slow,
} from "../../../common/pathing.ts";
import { Point } from "../../../common/types.ts";

export type LocalRun = { path: Point[]; duration: number; slows: Slow[] };

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
  blocks: ReadonlyArray<Point & { thunder?: boolean; local?: boolean }>,
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
 * checkpoint, overlapping another block, or blocking the only path. Temporarily
 * vacates `origin` and fills the candidate cells in `grid`, then restores it, so
 * a block can be dragged over/through where it currently sits.
 */
export const isInvalidMove = (
  grid: boolean[][],
  checkpoint: Point,
  origin: Point,
  x: number,
  y: number,
) => {
  if (Math.abs(checkpoint.x - x) + Math.abs(checkpoint.y - y) <= 1) return true;

  offsets.forEach(([xd, yd]) => grid[origin.y + yd][origin.x + xd] = false);
  let invalid = false;
  if (offsets.some(([xd, yd]) => grid[y + yd][x + xd])) invalid = true;
  else {
    offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = true);
    try {
      if (!findPath(grid, checkpoint)) invalid = true;
    } catch {
      invalid = true;
    }
    offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = false);
  }
  offsets.forEach(([xd, yd]) => grid[origin.y + yd][origin.x + xd] = true);
  return invalid;
};
