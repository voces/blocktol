import { assertEquals } from "@std/assert";
import { localRun, rebuildGrid } from "./helpers.ts";
import {
  findPathFromData,
  newGrid,
  pathDuration,
} from "../../../common/pathing.ts";

// Free play (and a debounced ranked build) shows the runner from localRun instead
// of a server response, so localRun MUST agree with what the server computes and
// accepts — the server times a placement via findPathFromData + pathDuration (see
// validateRun). If these ever diverge, the maze a player builds and the time the
// server records would drift. This pins them together.
Deno.test("localRun equals the server's findPathFromData + pathDuration", () => {
  // Checkpoints are half-integer cells (see newIteration / validateRun.test).
  const checkpoint = { x: 9.5, y: 9.5 };
  // A mix of plain blocks and a thunder, fixed pieces and player pieces alike —
  // localRun doesn't care which is which, only where they sit.
  const blocks = [
    { x: 5, y: 5 },
    { x: 6, y: 14 },
    { x: 13, y: 9, thunder: true },
    { x: 8, y: 8 },
  ];

  const grid = newGrid();
  rebuildGrid(grid, checkpoint, blocks);
  const local = localRun(grid, checkpoint, blocks.filter((b) => b.thunder));

  const path = findPathFromData(blocks, checkpoint);
  const [duration, slows] = pathDuration(path, blocks.filter((b) => b.thunder));

  assertEquals(local?.path, path);
  assertEquals(local?.duration, duration);
  assertEquals(local?.slows, slows);
});

// A momentarily path-less state (a block walling off the runner) returns
// undefined rather than throwing, so apply() keeps the prior run instead of
// blanking the board mid-edit.
Deno.test("localRun returns undefined when there is no path", () => {
  const checkpoint = { x: 9.5, y: 9.5 };
  // A solid interior row at y=13 — below the checkpoint, above the start (9,19).
  // Adjacent 1×1 blocks touch, so the runner can't reach the checkpoint.
  const wall = [];
  for (let x = 1; x <= 18; x++) wall.push({ x, y: 13 });
  const grid = newGrid();
  rebuildGrid(grid, checkpoint, wall);
  assertEquals(localRun(grid, checkpoint, []), undefined);
});
