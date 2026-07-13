import { offsets } from "../../common/constants.ts";
import { newGrid, pathDuration, PathSolver } from "../../common/pathing.ts";
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

  // The grid is overlap bookkeeping only; the solver owns reachability. One
  // solver on the empty board validates every incremental placement — the
  // same maze plus one piece per probe, exactly the edit-stream shape its
  // memo and one-added shortcut are built for. Existence answers are exact
  // whatever the thunder flags, so probes go in unflagged; the final timing
  // solve below is a separate cold construction.
  const grid = newGrid();
  grid[checkpoint.y + 0.5][checkpoint.x + 0.5] = true;
  const solver = new PathSolver([], checkpoint);
  const placed: Point[] = [];
  const placeIfSolvable = (x: number, y: number) => {
    if (offsets.some(([xd, yd]) => grid[y + yd][x + xd])) return false;
    if (!solver.solve([...placed, { x, y }])) return false;
    offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = true);
    placed.push({ x, y });
    return true;
  };

  let r = Math.random();
  let n = r < 0.04 ? 2 : r < 0.2 ? 1 : 0;
  const thunders: Point[] = [];
  while (n--) {
    const x = 2 + Math.floor(Math.random() * 17);
    const y = 2 + Math.floor(Math.random() * 17);
    if (placeIfSolvable(x, y)) thunders.push({ x, y });
  }

  n = Math.floor((1 - Math.random()) ** 0.5 * 49);
  const blocks: Point[] = [];
  while (n-- > 0 || blocks.length === 0) {
    const x = 2 + Math.floor(Math.random() * 17);
    const y = 2 + Math.floor(Math.random() * 17);
    if (placeIfSolvable(x, y)) blocks.push({ x, y });
  }

  r = Math.random();
  const power = r < 0.09 ? 2 : r < 0.3 ? 1 : 0;
  const bricks = power +
    Math.floor((1 - Math.random() ** 0.7) ** 0.9 * 20) + 3;

  // The stored `min` must be exactly what validateRun recomputes for the empty
  // placement later (audits compare them), so time the final board on a COLD
  // solver with the thunder flags in place — never a probe solver's
  // reuse-derived path, whose equal-length geometry could time differently
  // near a thunder.
  const path = new PathSolver(
    [...blocks, ...thunders.map((t) => ({ ...t, thunder: true }))],
    checkpoint,
  ).solve([]);
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
