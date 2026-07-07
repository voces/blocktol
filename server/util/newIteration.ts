import { offsets } from "../../common/constants.ts";
import { findPath, newGrid, pathDuration } from "../../common/pathing.ts";
import { Point } from "../../common/types.ts";
import { createIteration } from "../db/iteration.ts";
import { log } from "./logging.ts";

export const newIteration = async (date: Date) => {
  log.info("New iteration for", date.toDateString());

  // Interior cells are 1..18 (0 and 19 are the border ring). The checkpoint is a
  // single cell at coord + 0.5, so 0.5..17.5 spans the full interior and can sit
  // flush against any edge. (An earlier 1.5 start left cell 1 unused, so the
  // checkpoint could hug the bottom/right walls but never the top/left.)
  const checkpoint = {
    x: 0.5 + Math.floor(Math.random() * 18),
    y: 0.5 + Math.floor(Math.random() * 18),
  };
  const grid = newGrid();

  grid[checkpoint.y + 0.5][checkpoint.x + 0.5] = true;

  let r = Math.random();
  let n = r < 0.04 ? 2 : r < 0.2 ? 1 : 0;
  const thunders: Point[] = [];
  while (n--) {
    const x = 2 + Math.floor(Math.random() * 17);
    const y = 2 + Math.floor(Math.random() * 17);

    if (offsets.some(([xd, yd]) => grid[y + yd][x + xd])) continue;

    offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = true);

    if (!findPath(grid, checkpoint)) {
      offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = false);
    } else thunders.push({ x, y });
  }

  n = Math.floor((1 - Math.random()) ** 0.5 * 49);
  const blocks: Point[] = [];
  while (n-- > 0 || blocks.length === 0) {
    const x = 2 + Math.floor(Math.random() * 17);
    const y = 2 + Math.floor(Math.random() * 17);

    if (offsets.some(([xd, yd]) => grid[y + yd][x + xd])) continue;

    offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = true);

    if (!findPath(grid, checkpoint)) {
      offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = false);
    } else blocks.push({ x, y });
  }

  r = Math.random();
  const power = r < 0.09 ? 2 : r < 0.3 ? 1 : 0;
  const bricks = power +
    Math.floor((1 - Math.random() ** 0.7) ** 0.9 * 20) + 3;

  const path = findPath(grid, checkpoint);
  const [duration] = pathDuration(path, thunders);

  await createIteration(
    date,
    bricks,
    power,
    checkpoint,
    blocks,
    thunders,
    duration,
  );
};
