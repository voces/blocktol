import { assertEquals } from "@std/assert";
import { localRun, mazeBudget, rebuildGrid } from "./helpers.ts";
import { newGrid, pathDuration, PathSolver } from "../../../common/pathing.ts";
import { offsets } from "../../../common/constants.ts";

// Free play (and a debounced ranked build) shows the runner from localRun
// instead of a server response, so localRun MUST agree with what the server
// computes and accepts — the server times a placement via PathSolver +
// pathDuration (see validateRun). Same-engine matters beyond length: with
// thunders, duration depends on the path's geometry, so previewed and
// persisted times only stay equal if equal-length ties break identically too.
// This pins them together. (PathSolver's own optimality is asserted against a
// brute-force full-cell visibility graph in common/pathing.test.ts.)
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

// The brick/power chips are a FUNCTION of the maze on the board, not a tally
// stepped beside it. That's the whole point: the counts can only ever describe
// the pieces actually placed, so the player can never be offered a brick the
// iteration's budget doesn't have — which the server rejects at commit ("too
// many blocks"), losing the run.
Deno.test("mazeBudget counts what the maze holds", () => {
  const totals = { bricks: 6, power: 2 };
  assertEquals(mazeBudget([], totals), { bricks: 6, power: 2 });
  assertEquals(
    mazeBudget([{}, { thunder: true }, {}], totals),
    { bricks: 3, power: 1 },
  );
  // A thunder costs a brick AND a power, exactly as validateRun charges it.
  assertEquals(
    mazeBudget([{ thunder: true }, { thunder: true }], totals),
    { bricks: 4, power: 0 },
  );
});

// The incident this replaced: a delete refunded a brick, then a gesture landing
// before the input effects had re-run with the new board wrote back a maze that
// still held the deleted block. Stepping the count, the refund survived the
// resurrection and the HUD offered 7 bricks on a 6-brick day. Derived, the
// board is the only witness — whatever a race writes back, the chips describe
// THAT maze.
Deno.test("mazeBudget cannot drift from the maze a race writes back", () => {
  const totals = { bricks: 6, power: 2 };
  const maze: { x: number; y: number; thunder?: boolean }[] = [
    { x: 1, y: 1 },
    { x: 3, y: 3 },
    { x: 5, y: 5 },
  ];
  const deleted = maze.filter((b) => b !== maze[1]);
  assertEquals(mazeBudget(deleted, totals).bricks, 4);
  // A stale write puts the deleted block back: the count follows it back too,
  // rather than keeping the refund.
  assertEquals(mazeBudget(maze, totals).bricks, 3);
  // Removing a block that is already gone (a double tap) refunds nothing.
  assertEquals(
    mazeBudget(deleted.filter((b) => b !== maze[1]), totals).bricks,
    4,
  );
});

// A board with no budget loaded yet hides both chips (-1), and a maze can never
// drive a count negative — the clamp `viewMaze` relied on, now shared.
Deno.test("mazeBudget hides an unloaded budget and clamps at zero", () => {
  assertEquals(mazeBudget([{}], { bricks: -1, power: -1 }), {
    bricks: -1,
    power: -1,
  });
  assertEquals(
    mazeBudget([{}, {}, { thunder: true }], { bricks: 2, power: 0 }),
    { bricks: 0, power: 0 },
  );
});
