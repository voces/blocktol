import { test } from "node:test";
import { assertEquals } from "@std/assert";
import { diffMaze } from "./runTrace.ts";

test("diffMaze reads each gesture as its edit", () => {
  const a = { x: 2, y: 2 };
  const b = { x: 4, y: 2 };
  assertEquals(diffMaze([], [a]), [["p", 2, 2]]);
  assertEquals(diffMaze([a, b], [b]), [["d", 2, 2]]);
  assertEquals(diffMaze([a, b], [{ x: 6, y: 6 }, b]), [["m", 2, 2, 6, 6]]);
  assertEquals(diffMaze([a, b], [{ ...a, thunder: true }, b]), [["u", 2, 2]]);
  assertEquals(
    diffMaze([{ ...a, thunder: true }], [{ x: 8, y: 8, thunder: true }]),
    [["m", 2, 2, 8, 8]],
  );
  assertEquals(diffMaze([a, b], [b, a]), []);
});

test("diffMaze reports a multi-piece change piece by piece", () => {
  const a = { x: 2, y: 2 };
  const b = { x: 4, y: 2 };
  const c = { x: 6, y: 2 };
  assertEquals(diffMaze([], [a, b]), [["p", 2, 2], ["p", 4, 2]]);
  // A removal and an addition of different kinds is not a move.
  assertEquals(diffMaze([a], [{ ...c, thunder: true }]), [
    ["d", 2, 2],
    ["p", 6, 2],
  ]);
  assertEquals(diffMaze([a, b], [c]), [["d", 2, 2], ["d", 4, 2], ["p", 6, 2]]);
});
