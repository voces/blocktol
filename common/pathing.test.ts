import { assert, assertEquals } from "@std/assert";

import {
  findPath,
  findPathFromData,
  lineOfSight,
  newGrid,
  pathDuration,
  Slow,
} from "./pathing.ts";
import { offsets } from "./constants.ts";
import { Point } from "./types.ts";

Deno.test("pathDuration", async (t) => {
  const assertPathDuration = (
    points: Point[],
    thunders: Point[],
    duration: number,
    slows: Slow[] = [],
  ) => {
    const [actualDuration, actualSlows] = pathDuration(points, thunders ?? []);
    assert(
      Math.abs(actualDuration - duration) < 1e-9,
      `Expected duration to be ${duration}, got ${actualDuration}`,
    );
    assertEquals(actualSlows, slows);
  };

  await t.step("Without thunders", async (t) => {
    await t.step("zero points", () => assertPathDuration([], [], 0));

    await t.step(
      "one point",
      () => assertPathDuration([{ x: 0, y: 0 }], [], 0),
    );

    await t.step(
      "two points (vertical down)",
      () =>
        assertPathDuration(
          [
            { x: 0, y: 0 },
            { x: 0, y: 1 },
          ],
          [],
          0.2,
        ),
    );

    await t.step(
      "two points (vertical down twice)",
      () =>
        assertPathDuration(
          [
            { x: 0, y: 0 },
            { x: 0, y: 2 },
          ],
          [],
          0.4,
        ),
    );

    await t.step(
      "two points (vertical up)",
      () =>
        assertPathDuration(
          [
            { x: 0, y: 0 },
            { x: 0, y: -1 },
          ],
          [],
          0.2,
        ),
    );

    await t.step(
      "two points (diag)",
      () =>
        assertPathDuration(
          [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
          [],
          0.30, // 0.20*√2 = ~0.283, round up 0.02 seconds
        ),
    );

    await t.step(
      "three points",
      () =>
        assertPathDuration(
          [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
          ],
          [],
          0.5, // 0.20*√2 + 0.2 = ~0.483, round up
        ),
    );

    await t.step(
      "many points",
      () =>
        assertPathDuration(
          [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
            { x: 0, y: 2 },
            { x: 1, y: 2 },
            { x: 2, y: 2 },
          ],
          [],
          1.2,
        ),
    );
  });

  await t.step("With thunders", async (t) => {
    await t.step("without nearing", () =>
      assertPathDuration([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ], [
        { x: 4.5, y: 9.5 },
      ], 20));

    await t.step("walking past", () =>
      assertPathDuration(
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        [
          // Note this isn't valid, as the runner walks through a thunder,
          // but easier math
          { x: 4.5, y: -0.5 },
        ],
        23, // slowed for six seconds by half
        [{ thunder: { x: 4.5, y: -0.5 }, time: 0.22 }], // 1 tile + step into next
      ));
  });
});

const length = (path: ReadonlyArray<Point>) => {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += ((path[i].x - path[i - 1].x) ** 2 +
      (path[i].y - path[i - 1].y) ** 2) ** 0.5;
  }
  return total;
};

// Independent optimum: a visibility graph over *every* free cell (a superset of
// the corner nodes findPath uses), sharing the exact same `lineOfSight` oracle.
// If findPath's corner-restricted search were ever suboptimal, this denser graph
// would find something strictly shorter.
const bruteOptimalLength = (
  start: Point,
  end: Point,
  grid: boolean[][],
) => {
  const nodes: Point[] = [start, end];
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      if (grid[y][x] === false && !(x === start.x && y === start.y)) {
        nodes.push({ x, y });
      }
    }
  }
  const n = nodes.length;
  const dist = Array<number>(n).fill(Infinity);
  const done = Array<boolean>(n).fill(false);
  dist[0] = 0;
  for (let it = 0; it < n; it++) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      if (!done[i] && dist[i] < best) best = dist[i], u = i;
    }
    if (u < 0) break;
    done[u] = true;
    for (let v = 0; v < n; v++) {
      if (done[v] || !lineOfSight(nodes[u], nodes[v], grid)) continue;
      const nd = dist[u] +
        ((nodes[u].x - nodes[v].x) ** 2 + (nodes[u].y - nodes[v].y) ** 2) **
          0.5;
      if (nd < dist[v]) dist[v] = nd;
    }
  }
  return dist[1];
};

Deno.test("findPath — any-angle optimality", async (t) => {
  await t.step("unobstructed run is a single straight segment", () => {
    const grid = newGrid();
    const path = findPath(grid, { x: 9.5, y: 18.5 })!;
    // start -> checkpoint cell (10,19) -> end, both straight.
    assertEquals(path.length, 3);
    assert(
      Math.abs(
        length(path) - (length([{ x: 9, y: 19 }, { x: 10, y: 19 }]) +
          length([{ x: 10, y: 19 }, { x: 10, y: 0 }])),
      ) < 1e-9,
    );
  });

  await t.step(
    "refuses to squeeze a unit runner through a diagonal gap",
    () => {
      // Two blocks touching only at a corner leave a zero-width gap the 1x1
      // runner cannot pass — the straight diagonal must not be line-of-sight.
      const grid = newGrid();
      for (const [xd, yd] of offsets) {
        grid[8 + yd][8 + xd] = true; // block at (8,8): cells (8..9, 8..9)
        grid[10 + yd][10 + xd] = true; // block at (10,10): cells (10..11, 10..11)
      }
      assert(!lineOfSight({ x: 9, y: 9 }, { x: 10, y: 10 }, grid));
    },
  );

  await t.step("matches a full-cell visibility-graph optimum", () => {
    // Deterministic LCG so the property check is reproducible across runs.
    let s = 424242 >>> 0;
    const rng = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;

    let checked = 0;
    for (let seed = 0; seed < 60; seed++) {
      const grid = newGrid();
      const checkpoint = {
        x: 1.5 + Math.floor(rng() * 17),
        y: 1.5 + Math.floor(rng() * 17),
      };
      grid[checkpoint.y + 0.5][checkpoint.x + 0.5] = true;
      const blockCount = 3 + Math.floor(rng() * 28);
      for (let b = 0; b < blockCount; b++) {
        const x = 2 + Math.floor(rng() * 17);
        const y = 2 + Math.floor(rng() * 17);
        if (offsets.some(([xd, yd]) => grid[y + yd][x + xd])) continue;
        offsets.forEach(([xd, yd]) => (grid[y + yd][x + xd] = true));
      }

      const path = findPath(structuredClone(grid), checkpoint);
      if (!path) continue;
      checked++;

      // Reproduce findPath's internal grid (checkpoint cell walkable) for brute.
      const g = structuredClone(grid);
      g[checkpoint.y + 0.5][checkpoint.x + 0.5] = false;
      const cell = { x: checkpoint.x + 0.5, y: checkpoint.y + 0.5 };
      const optimum = bruteOptimalLength({ x: 9, y: 19 }, cell, g) +
        bruteOptimalLength(cell, { x: 10, y: 0 }, g);

      assert(
        length(path) <= optimum + 1e-6,
        `seed ${seed}: findPath ${length(path)} > optimum ${optimum}`,
      );
    }
    assert(checked > 40, `expected many solvable boards, got ${checked}`);
  });
});

Deno.test("findPathFromData rejects overlapping placements", () => {
  // Two blocks sharing a cell is invalid data and must throw, not path.
  let threw = false;
  try {
    findPathFromData([{ x: 5, y: 5 }, { x: 6, y: 5 }], { x: 9.5, y: 9.5 });
  } catch {
    threw = true;
  }
  assert(threw);
});
