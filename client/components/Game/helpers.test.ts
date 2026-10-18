import { assertEquals } from "@std/assert";
import { localRun, mazeBudget, rebuildGrid } from "./helpers.ts";
import { newGrid, pathDuration, PathSolver } from "../../../common/pathing.ts";
import { offsets } from "../../../common/constants.ts";

// The runner comes from localRun, not a server response, so it MUST agree with
// the server's PathSolver + pathDuration (see validateRun). With thunders,
// duration depends on path geometry, so times match only if equal-length ties
// break identically too. (PathSolver's optimality is tested in
// common/pathing.test.ts.)
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
  // The whole board, `local` marking the player's pieces, as in useGameState.
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

// A path-less state (a wall cutting the board in two) returns undefined rather
// than throwing, so apply() keeps the prior run mid-edit.
Deno.test("localRun returns undefined when there is no path", () => {
  const checkpoint = { x: 9.5, y: 9.5 };
  // A solid interior band at y=13..14 — below the checkpoint, above the start
  // (9,19). Anchors two apart tile 2×2 pieces edge-to-edge without overlap.
  const wall = [];
  for (let x = 1; x <= 17; x += 2) wall.push({ x, y: 13, local: true });
  assertEquals(localRun(wall, checkpoint), undefined);
});

// rebuildGrid feeds the hover/drag validity checks; it must reproduce a fresh
// grid plus placements, clearing stale cells.
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

// The chips are a FUNCTION of the maze on the board, not a stepped tally, so
// the player is never offered a brick the budget lacks (the server rejects it
// at commit: "too many blocks").
Deno.test("mazeBudget counts what the maze holds", () => {
  const totals = { bricks: 6, power: 2 };
  assertEquals(mazeBudget([], totals), { bricks: 6, power: 2 });
  assertEquals(
    mazeBudget([{}, { thunder: true }, {}], totals),
    { bricks: 3, power: 1 },
  );
  // A thunder costs a brick AND a power, as validateRun charges it.
  assertEquals(
    mazeBudget([{ thunder: true }, { thunder: true }], totals),
    { bricks: 4, power: 0 },
  );
});

// The race: a delete refunded a brick, then a gesture landing before the input
// effects re-ran wrote back a maze still holding the deleted block. A stepped
// count kept the refund (7 bricks on a 6-brick day); a derived one follows the
// maze.
Deno.test("mazeBudget cannot drift from the maze a race writes back", () => {
  const totals = { bricks: 6, power: 2 };
  const maze: { x: number; y: number; thunder?: boolean }[] = [
    { x: 1, y: 1 },
    { x: 3, y: 3 },
    { x: 5, y: 5 },
  ];
  const deleted = maze.filter((b) => b !== maze[1]);
  assertEquals(mazeBudget(deleted, totals).bricks, 4);
  // A stale write puts the block back: the count follows, no kept refund.
  assertEquals(mazeBudget(maze, totals).bricks, 3);
  // Removing a block that is already gone (a double tap) refunds nothing.
  assertEquals(
    mazeBudget(deleted.filter((b) => b !== maze[1]), totals).bricks,
    4,
  );
});

// An unloaded budget hides both chips (-1), and a maze never drives a count
// negative (`mazeBudget` clamps).
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
