import { assertEquals } from "@std/assert";
import { localRun, rebuildGrid } from "./helpers.ts";
import { newGrid, pathDuration, PathSolver } from "../../../common/pathing.ts";
import { offsets } from "../../../common/constants.ts";

// Free play (and a debounced ranked build) shows the runner from localRun
// instead of a server response, so localRun MUST agree with what the server
// computes and accepts — the server times a placement via PathSolver +
// pathDuration (see validateRun). Same-engine matters beyond length: with
// thunders, duration depends on the path's geometry, so previewed and
// persisted times only stay equal if equal-length ties break identically too.
// This pins them together. (PathSolver's own length parity with the
// brute-verified findPathFromData is asserted in common/pathing.test.ts.)
Deno.test("localRun equals the server's PathSolver + pathDuration", () => {
  // Checkpoints are half-integer cells (see newIteration / validateRun.test).
  const checkpoint = { x: 9.5, y: 9.5 };
  const fixed = [
    { x: 5, y: 5 },
    { x: 13, y: 9, thunder: true },
  ];
  const player = [
    { x: 6, y: 14 },
    { x: 8, y: 8, thunder: true },
  ];
  // localRun sees the whole board, `local` marking the player's pieces —
  // exactly how useGameState's `blocks` is shaped.
  const blocks = [...fixed, ...player.map((b) => ({ ...b, local: true }))];

  const local = localRun(blocks, checkpoint);

  const path = new PathSolver(fixed, checkpoint).solve(player);
  const [duration, slows] = pathDuration(
    path,
    blocks.filter((b) => b.thunder),
  );

  assertEquals(local?.path, path);
  assertEquals(local?.duration, duration);
  assertEquals(local?.slows, slows);
});

// A momentarily path-less state (a wall cutting the board in two) returns
// undefined rather than throwing, so apply() keeps the prior run instead of
// blanking the board mid-edit.
Deno.test("localRun returns undefined when there is no path", () => {
  const checkpoint = { x: 9.5, y: 9.5 };
  // A solid interior band at y=13..14 — below the checkpoint, above the start
  // (9,19). Anchors two apart tile 2×2 pieces edge-to-edge without overlap.
  const wall = [];
  for (let x = 1; x <= 17; x += 2) wall.push({ x, y: 13, local: true });
  assertEquals(localRun(wall, checkpoint), undefined);
});

// rebuildGrid still feeds the hover/drag validity checks their grid; it must
// reproduce a fresh grid plus placements exactly, clearing any stale cells.
Deno.test("rebuildGrid reproduces a fresh grid with placements", () => {
  const checkpoint = { x: 9.5, y: 9.5 };
  const blocks = [{ x: 5, y: 5 }, { x: 12, y: 3 }];
  const grid = newGrid();
  grid[7][3] = true; // stale cell that must be cleared
  rebuildGrid(grid, checkpoint, blocks);

  const expected = newGrid();
  expected[checkpoint.y + 0.5][checkpoint.x + 0.5] = true;
  for (const { x, y } of blocks) {
    offsets.forEach(([xd, yd]) => (expected[y + yd][x + xd] = true));
  }
  assertEquals(grid, expected);
});
