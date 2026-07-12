import { assert, assertEquals } from "@std/assert";

import {
  cachedSolver,
  findPath,
  findPathFromData,
  lineOfSight,
  newGrid,
  pathDuration,
  PathSolver,
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

Deno.test("findPath returns undefined for an off-board checkpoint", () => {
  // On page load the board holds the off-board sentinel checkpoint {-2,-2} on a
  // fresh grid whose fractional checkpoint row was never allocated. A hover can
  // call findPath in that state; it must return undefined, not throw
  // "Cannot set properties of undefined" writing into the missing row.
  const grid = newGrid();
  assertEquals(findPath(grid, { x: -2, y: -2 }), undefined);
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

Deno.test("PathSolver matches findPathFromData", async (t) => {
  // findPathFromData is the brute-verified reference (see the optimality test
  // above), so parity here transitively covers the solver's optimality.
  // Deterministic LCG so failures are reproducible.
  let s = 24681357 >>> 0;
  const rng = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;

  // Attempt random non-overlapping 2x2 anchors on `grid`, mutating it, and
  // return the ones that fit — the same shape newIteration/players produce.
  const placeRandom = (grid: boolean[][], count: number) => {
    const anchors: Point[] = [];
    for (let i = 0; i < count; i++) {
      const x = 2 + Math.floor(rng() * 16);
      const y = 2 + Math.floor(rng() * 16);
      if (offsets.some(([xd, yd]) => grid[y + yd][x + xd])) continue;
      offsets.forEach(([xd, yd]) => (grid[y + yd][x + xd] = true));
      anchors.push({ x, y });
    }
    return anchors;
  };

  await t.step(
    "solvability and length parity, with solver reuse across solves",
    () => {
      let checkedPaths = 0;
      for (let seed = 0; seed < 120; seed++) {
        const checkpoint = {
          x: 1.5 + Math.floor(rng() * 17),
          y: 1.5 + Math.floor(rng() * 17),
        };
        // Scratch grid only to generate non-overlapping placements; the
        // engines under test rebuild their own boards from the anchor lists.
        const scratch = newGrid();
        scratch[checkpoint.y + 0.5][checkpoint.x + 0.5] = true;
        const base = placeRandom(scratch, 2 + Math.floor(rng() * 7));

        const solver = new PathSolver(base, checkpoint);

        // Several placements against ONE solver instance: any grid-restore
        // bug in solve() poisons the later rounds.
        for (let round = 0; round < 3; round++) {
          const roundScratch = structuredClone(scratch);
          const pieces = placeRandom(roundScratch, Math.floor(rng() * 22));

          const expected = findPathFromData([...base, ...pieces], checkpoint);
          const actual = solver.solve(pieces);

          assertEquals(
            !!actual,
            !!expected,
            `seed ${seed} round ${round}: solvability diverged`,
          );
          if (!expected || !actual) continue;
          checkedPaths++;
          assert(
            Math.abs(length(actual) - length(expected)) < 1e-9,
            `seed ${seed} round ${round}: solver ${length(actual)} != ` +
              `reference ${length(expected)}`,
          );
        }
      }
      assert(
        checkedPaths > 200,
        `expected many solved rounds, got ${checkedPaths}`,
      );
    },
  );

  await t.step(
    "rejects bad placements and survives a half-placed throw",
    () => {
      const checkpoint = { x: 9.5, y: 9.5 };
      const solver = new PathSolver([{ x: 4, y: 4 }], checkpoint);
      const good = solver.solve([{ x: 12, y: 12 }])!;
      assert(good);

      // Overlapping the base block, the checkpoint cell, and a second piece that
      // overlaps the first: all must throw like findPathFromData — and the last
      // one only after the first piece was already placed, exercising the
      // mid-throw grid restore.
      for (
        const bad of [
          [{ x: 5, y: 5 }],
          [{ x: 9, y: 9 }],
          [{ x: 12, y: 12 }, { x: 13, y: 13 }],
        ]
      ) {
        let threw = false;
        try {
          solver.solve(bad);
        } catch {
          threw = true;
        }
        assert(threw, `expected throw for ${JSON.stringify(bad)}`);
      }

      // The shared grid must be back to base: the original solve still returns
      // the identical path.
      assertEquals(solver.solve([{ x: 12, y: 12 }]), good);
    },
  );

  await t.step("piece order never changes the returned path", () => {
    // Dijkstra tie-breaks by node order, and piece-created corner nodes are
    // sorted into row-major order before joining the graph — so the same maze
    // handed over in save-placement order and in reversed order must return
    // the IDENTICAL path (not merely an equal-length one). Duration exactness
    // near thunders depends on this.
    for (let seed = 0; seed < 40; seed++) {
      const checkpoint = {
        x: 1.5 + Math.floor(rng() * 17),
        y: 1.5 + Math.floor(rng() * 17),
      };
      const scratch = newGrid();
      scratch[checkpoint.y + 0.5][checkpoint.x + 0.5] = true;
      const base = placeRandom(scratch, 2 + Math.floor(rng() * 6));
      const pieces = placeRandom(scratch, 4 + Math.floor(rng() * 14));
      // Fresh solvers on purpose: a shared one would trivially agree through
      // its result memo; this asserts the ENGINE is order-independent.
      const a = new PathSolver(base, checkpoint).solve(pieces);
      const b = new PathSolver(base, checkpoint)
        .solve([...pieces].reverse());
      assertEquals(a, b, `seed ${seed}: piece order changed the path`);
    }
  });

  await t.step("an edit stream stays exactly equal to cold solves", () => {
    // Replays what a build session does to one long-lived solver — add a
    // block, remove one, upgrade one to a thunder — and asserts after every
    // edit that the warm solver (memo + reuse shortcut) matches a cold
    // solver exactly where it counts: same solvability, same length, and the
    // same duration to the digit, thunders included. This is the audit
    // invariant: a cold recompute must reproduce every persisted time.
    for (let seed = 0; seed < 25; seed++) {
      const checkpoint = {
        x: 1.5 + Math.floor(rng() * 17),
        y: 1.5 + Math.floor(rng() * 17),
      };
      const occupied = newGrid();
      occupied[checkpoint.y + 0.5][checkpoint.x + 0.5] = true;
      const base: (Point & { thunder?: boolean })[] = placeRandom(
        occupied,
        2 + Math.floor(rng() * 6),
      ).map((b) => (rng() < 0.25 ? { ...b, thunder: true } : b));
      const solver = new PathSolver(base, checkpoint);

      const pieces: (Point & { thunder?: boolean })[] = [];
      for (let edit = 0; edit < 14; edit++) {
        const op = rng();
        if (op < 0.55 || pieces.length === 0) {
          const added = placeRandom(occupied, 1);
          if (!added.length) continue;
          pieces.push(added[0]);
        } else if (op < 0.8) {
          const [gone] = pieces.splice(Math.floor(rng() * pieces.length), 1);
          offsets.forEach((
            [xd, yd],
          ) => (occupied[gone.y + yd][gone.x + xd] = false));
        } else {
          const i = Math.floor(rng() * pieces.length);
          pieces[i] = { ...pieces[i], thunder: !pieces[i].thunder };
        }

        const warm = solver.solve(pieces);
        const cold = new PathSolver(base, checkpoint).solve(pieces);
        assertEquals(
          !!warm,
          !!cold,
          `seed ${seed} edit ${edit}: solvability diverged`,
        );
        if (!warm || !cold) continue;
        assert(
          Math.abs(length(warm) - length(cold)) < 1e-9,
          `seed ${seed} edit ${edit}: warm ${length(warm)} != cold ${
            length(cold)
          }`,
        );
        const thunders = [...base, ...pieces].filter((b) => b.thunder);
        assertEquals(
          pathDuration(warm, thunders)[0],
          pathDuration(cold, thunders)[0],
          `seed ${seed} edit ${edit}: durations diverged`,
        );
      }
    }
  });

  await t.step("cachedSolver shares one solver per base board", () => {
    const checkpoint = { x: 9.5, y: 9.5 };
    const a = cachedSolver([{ x: 5, y: 5 }, { x: 12, y: 3 }], checkpoint);
    // Same content, different order — the key is content-addressed.
    const b = cachedSolver([{ x: 12, y: 3 }, { x: 5, y: 5 }], checkpoint);
    assert(a === b);

    // The memoized base result returns equal paths but fresh arrays, so a
    // caller mutating its copy can't poison the cache.
    const p1 = a.solve([])!;
    const p2 = a.solve([])!;
    assertEquals(p1, p2);
    assert(p1 !== p2);
    assert(p1[0] !== p2[0]);
  });

  await t.step("covering an endpoint yields no path, not a crash", () => {
    const checkpoint = { x: 9.5, y: 9.5 };
    const solver = new PathSolver([], checkpoint);
    // (9,18) covers the start cell (9,19); the runner has nowhere to stand.
    assertEquals(solver.solve([{ x: 9, y: 18 }]), undefined);
    assertEquals(findPathFromData([{ x: 9, y: 18 }], checkpoint), undefined);
  });
});
