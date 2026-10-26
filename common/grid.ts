import { offsets } from "./constants.ts";
import type { Point } from "./types.ts";

// The pathing grid (`newGrid` in pathing.ts): rows are y, columns x, and true
// is a blocked cell. A piece is 2x2, anchored at its top-left cell.

// A cell off the grid reads as free: callers place only on-board pieces, and
// the solver's own corner search treats the edge separately.
export const cellBlocked = (grid: boolean[][], x: number, y: number) =>
  grid[y]?.[x] === true;

// Throws for a row off the grid rather than growing the grid.
export const setCell = (
  grid: boolean[][],
  x: number,
  y: number,
  blocked: boolean,
) => {
  const row = grid[y];
  if (!row) throw new RangeError(`grid has no row ${y}`);
  row[x] = blocked;
};

// Whether any of the piece's four cells is blocked.
export const pieceOverlaps = (grid: boolean[][], { x, y }: Point) =>
  offsets.some(([xd, yd]) => cellBlocked(grid, x + xd, y + yd));

export const setPiece = (
  grid: boolean[][],
  { x, y }: Point,
  blocked: boolean,
) => {
  for (const [xd, yd] of offsets) setCell(grid, x + xd, y + yd, blocked);
};

// The checkpoint is stored at a cell's centre (x.5, y.5) and blocks that cell.
export const setCheckpoint = (
  grid: boolean[][],
  checkpoint: Point,
  blocked: boolean,
) => setCell(grid, checkpoint.x + 0.5, checkpoint.y + 0.5, blocked);
