import { test } from "node:test";
import { assert, assertEquals, assertExists } from "@std/assert";

import {
  cachedSolver,
  lineOfSight,
  newGrid,
  pathDuration,
  PathSolver,
  type Slow,
} from "./pathing.ts";
import { pairs } from "./arrays.ts";
import { pieceOverlaps, setCheckpoint, setPiece } from "./grid.ts";
import type { Point } from "./types.ts";

test("pathDuration", async (t) => {
  const assertPathDuration = (
    points: Point[],
    thunders: Point[],
    duration: number,
    slows: Slow[] = [],
  ) => {
    const [actualDuration, actualSlows] = pathDuration(points, thunders);
    assert(
      Math.abs(actualDuration - duration) < 1e-9,
      `Expected duration to be ${duration}, got ${actualDuration}`,
    );
    assertEquals(actualSlows, slows);
  };

  await t.test("Without thunders", async (t) => {
    await t.test("zero points", () => assertPathDuration([], [], 0));

    await t.test(
      "one point",
      () => assertPathDuration([{ x: 0, y: 0 }], [], 0),
    );

    await t.test(
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

    await t.test(
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

    await t.test(
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

    await t.test(
      "two points (diag)",
      () =>
        assertPathDuration(
          [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
          [],
          0.28, // √2/5 ≈ 0.2828, rounded (continuous, not tick-quantized)
        ),
    );

    await t.test(
      "three points",
      () =>
        assertPathDuration(
          [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
          ],
          [],
          0.48, // (√2 + 1)/5 = ~0.4828, rounded
        ),
    );

    await t.test(
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

  await t.test("With thunders", async (t) => {
    await t.test("without nearing", () =>
      assertPathDuration([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ], [
        { x: 4.5, y: 9.5 },
      ], 20));

    await t.test("walking past", () =>
      assertPathDuration(
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        [
          // Invalid in play (the runner walks through the thunder), but easier
          // math.
          { x: 4.5, y: -0.5 },
        ],
        23, // slowed for six seconds by half: 100/5 + 6/2
        // Centre (5,0), radius 4: range entry at distance 1 = 0.2s. No
        // re-trigger: the cooldown expires (3.4s) just as the slowed runner
        // reaches the range EXIT (distance 9), a graze ("in range" is strict).
        [{ thunder: { x: 4.5, y: -0.5 }, time: 0.2 }],
      ));

    await t.test("simultaneous triggers share one slow", () => {
      // Two thunders mirrored across the path have identical windows and fire
      // at the same instant. Both are recorded, but the slow is shared, so the
      // duration equals the single-thunder run's.
      const path = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
      const pair: [Point, Point] = [{ x: 4.5, y: 2.5 }, { x: 4.5, y: -3.5 }]; // centres (5,±3)
      const entry = (5 - Math.sqrt(7)) / 5; // |x-5| < √(16-9) from x=0, at SPEED
      assertPathDuration(path, pair, 23, [
        { thunder: pair[0], time: Math.round(entry * 100) / 100 },
        { thunder: pair[1], time: Math.round(entry * 100) / 100 },
      ]);
      assertPathDuration(path, [pair[0]], 23, [
        { thunder: pair[0], time: Math.round(entry * 100) / 100 },
      ]);
    });

    await t.test("a re-trigger resets the slow, never stacks", () => {
      // The second thunder is 10 units downstream: the slowed runner (2.5/s)
      // reaches its window 4s after the first trigger, mid-slow. The slow
      // RESETS to 6s, so slowed time is 4 + 6 = 10s and the first slow's last
      // 2s are wasted: 100/5 + 10/2 = 25.
      const path = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
      const thunders: [Point, Point] = [{ x: 4.5, y: 2.5 }, {
        x: 14.5,
        y: 2.5,
      }];
      const t1 = (5 - Math.sqrt(7)) / 5;
      assertPathDuration(path, thunders, 25, [
        { thunder: thunders[0], time: Math.round(t1 * 100) / 100 },
        { thunder: thunders[1], time: Math.round((t1 + 4) * 100) / 100 },
      ]);
    });

    await t.test("a window thinner than the old tick still triggers", () => {
      // Centre 3.9997 off the path: in range for only ~0.05 distance, which a
      // 0.1-step simulation could skip. The continuous walk cannot.
      const path = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
      const thunder = { x: 4.5, y: 3.4997 };
      const [duration, slows] = pathDuration(path, [thunder]);
      assert(Math.abs(duration - 23) < 1e-9, `expected 23, got ${duration}`);
      assertEquals(slows.length, 1);
    });
  });
});

const length = (path: ReadonlyArray<Point>) => {
  let total = 0;
  for (const [a, b] of pairs(path)) {
    total += ((b.x - a.x) ** 2 + (b.y - a.y) ** 2) ** 0.5;
  }
  return total;
};

// Independent optimum: a visibility graph over *every* free cell (a superset of
// PathSolver's corner nodes) using the same `lineOfSight` oracle. If the
// corner-restricted search were suboptimal, this would find something shorter.
const bruteOptimalLength = (
  start: Point,
  end: Point,
  grid: boolean[][],
) => {
  const nodes: Point[] = [start, end];
  for (const [y, row] of grid.entries()) {
    for (const [x, blocked] of row.entries()) {
      if (!blocked && !(x === start.x && y === start.y)) nodes.push({ x, y });
    }
  }
  // Dijkstra over every pair of nodes in line of sight.
  const dist = new Map<Point, number>([[start, 0]]);
  const done = new Set<Point>();
  while (true) {
    let u: Point | undefined;
    let du = Infinity;
    for (const [node, d] of dist) {
      if (!done.has(node) && d < du) {
        u = node;
        du = d;
      }
    }
    if (!u) break;
    done.add(u);
    for (const v of nodes) {
      if (done.has(v) || !lineOfSight(u, v, grid)) continue;
      const nd = du + ((u.x - v.x) ** 2 + (u.y - v.y) ** 2) ** 0.5;
      if (nd < (dist.get(v) ?? Infinity)) dist.set(v, nd);
    }
  }
  return dist.get(end) ?? Infinity;
};

test("PathSolver — any-angle optimality", async (t) => {
  await t.test("unobstructed run is a single straight segment", () => {
    const path = new PathSolver([], { x: 9.5, y: 18.5 }).solve([]);
    assertExists(path);
    // start -> checkpoint cell (10,19) -> end, both straight.
    assertEquals(path.length, 3);
    assert(
      Math.abs(
        length(path) - (length([{ x: 9, y: 19 }, { x: 10, y: 19 }]) +
          length([{ x: 10, y: 19 }, { x: 10, y: 0 }])),
      ) < 1e-9,
    );
  });

  await t.test(
    "refuses to squeeze a unit runner through a diagonal gap",
    () => {
      // Two blocks touching only at a corner leave a zero-width gap: the
      // diagonal must not be line-of-sight.
      const grid = newGrid();
      setPiece(grid, { x: 8, y: 8 }, true); // cells (8..9, 8..9)
      setPiece(grid, { x: 10, y: 10 }, true); // cells (10..11, 10..11)
      assert(!lineOfSight({ x: 9, y: 9 }, { x: 10, y: 10 }, grid));
    },
  );

  await t.test("matches a full-cell visibility-graph optimum", () => {
    // Deterministic LCG, so runs are reproducible.
    let s = 424242 >>> 0;
    const rng = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;

    let checked = 0;
    for (let seed = 0; seed < 60; seed++) {
      const grid = newGrid();
      const checkpoint = {
        x: 1.5 + Math.floor(rng() * 17),
        y: 1.5 + Math.floor(rng() * 17),
      };
      setCheckpoint(grid, checkpoint, true);
      const anchors: Point[] = [];
      const blockCount = 3 + Math.floor(rng() * 28);
      for (let b = 0; b < blockCount; b++) {
        const x = 2 + Math.floor(rng() * 17);
        const y = 2 + Math.floor(rng() * 17);
        if (pieceOverlaps(grid, { x, y })) continue;
        setPiece(grid, { x, y }, true);
        anchors.push({ x, y });
      }

      // Split anchors between the base and solve-time pieces so this also
      // covers the augmented-board machinery (ring corners), not just base
      // solves.
      const split = Math.floor(rng() * (anchors.length + 1));
      const path = new PathSolver(anchors.slice(0, split), checkpoint)
        .solve(anchors.slice(split));
      if (!path) continue;
      checked++;

      // Reproduce the search's internal grid (checkpoint cell walkable).
      const g = structuredClone(grid);
      setCheckpoint(g, checkpoint, false);
      const cell = { x: checkpoint.x + 0.5, y: checkpoint.y + 0.5 };
      const optimum = bruteOptimalLength({ x: 9, y: 19 }, cell, g) +
        bruteOptimalLength(cell, { x: 10, y: 0 }, g);

      assert(
        length(path) <= optimum + 1e-6,
        `seed ${seed}: solver ${length(path)} > optimum ${optimum}`,
      );
    }
    assert(checked > 40, `expected many solvable boards, got ${checked}`);
  });
});

test("PathSolver throws for an off-board checkpoint", () => {
  // On page load the board holds the off-board sentinel checkpoint {-2,-2}.
  // Construction throws; the client's localRun/solvable helpers catch it and
  // read the board as path-less rather than crashing a hover.
  let threw = false;
  try {
    new PathSolver([], { x: -2, y: -2 });
  } catch {
    threw = true;
  }
  assert(threw);
});

test("PathSolver rejects overlapping placements", () => {
  // Blocks sharing a cell must throw, in the base board or at solve time.
  let threw = false;
  try {
    new PathSolver([{ x: 5, y: 5 }, { x: 6, y: 5 }], { x: 9.5, y: 9.5 });
  } catch {
    threw = true;
  }
  assert(threw);
});

test("PathSolver reuse and edit-stream layer", async (t) => {
  // The optimality test above checks correctness against the brute oracle;
  // these steps pin SHARED-INSTANCE behaviour (grid restoration, the result
  // memo, `oneAddedShortcut`) to a cold solver. Deterministic LCG.
  let s = 24681357 >>> 0;
  const rng = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;

  // Try random 2x2 anchors on `grid`, mutating it, and return those that fit.
  const placeRandom = (grid: boolean[][], count: number) => {
    const anchors: Point[] = [];
    for (let i = 0; i < count; i++) {
      const x = 2 + Math.floor(rng() * 16);
      const y = 2 + Math.floor(rng() * 16);
      if (pieceOverlaps(grid, { x, y })) continue;
      setPiece(grid, { x, y }, true);
      anchors.push({ x, y });
    }
    return anchors;
  };

  await t.test(
    "solvability and length parity, with solver reuse across solves",
    () => {
      let checkedPaths = 0;
      for (let seed = 0; seed < 120; seed++) {
        const checkpoint = {
          x: 1.5 + Math.floor(rng() * 17),
          y: 1.5 + Math.floor(rng() * 17),
        };
        // Scratch grid only to generate non-overlapping placements.
        const scratch = newGrid();
        setCheckpoint(scratch, checkpoint, true);
        const base = placeRandom(scratch, 2 + Math.floor(rng() * 7));

        const solver = new PathSolver(base, checkpoint);

        // Several placements against ONE solver instance: any grid-restore
        // bug in solve() poisons the later rounds.
        for (let round = 0; round < 3; round++) {
          const roundScratch = structuredClone(scratch);
          const pieces = placeRandom(roundScratch, Math.floor(rng() * 22));

          const expected = new PathSolver(base, checkpoint).solve(pieces);
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

  await t.test(
    "rejects bad placements and survives a half-placed throw",
    () => {
      const checkpoint = { x: 9.5, y: 9.5 };
      const solver = new PathSolver([{ x: 4, y: 4 }], checkpoint);
      const good = solver.solve([{ x: 12, y: 12 }]);
      assertExists(good);

      // Overlapping the base block, the checkpoint cell, and an earlier piece
      // must all throw. The last throws after the first piece is already
      // placed, exercising the mid-throw grid restore.
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

      // The grid is back to base: the original solve returns the same path.
      assertEquals(solver.solve([{ x: 12, y: 12 }]), good);
    },
  );

  await t.test("piece order never changes the returned path", () => {
    // The same maze in save order and reversed order must return the IDENTICAL
    // path, not merely an equal-length one: duration near thunders depends on
    // it (ring corners are sorted row-major for this reason).
    for (let seed = 0; seed < 40; seed++) {
      const checkpoint = {
        x: 1.5 + Math.floor(rng() * 17),
        y: 1.5 + Math.floor(rng() * 17),
      };
      const scratch = newGrid();
      setCheckpoint(scratch, checkpoint, true);
      const base = placeRandom(scratch, 2 + Math.floor(rng() * 6));
      const pieces = placeRandom(scratch, 4 + Math.floor(rng() * 14));
      // Fresh solvers: a shared one would agree through its memo; this tests
      // the ENGINE.
      const a = new PathSolver(base, checkpoint).solve(pieces);
      const b = new PathSolver(base, checkpoint)
        .solve([...pieces].reverse());
      assertEquals(a, b, `seed ${seed}: piece order changed the path`);
    }
  });

  await t.test("an edit stream stays exactly equal to cold solves", () => {
    // Replays a build session on one long-lived solver (add a block, remove
    // one, upgrade one to a thunder) and asserts after every edit that the warm
    // solver (memo + shortcut) matches a cold one: same solvability, length and
    // duration, thunders included. This is the audit invariant: a cold
    // recompute reproduces every persisted time.
    for (let seed = 0; seed < 25; seed++) {
      const checkpoint = {
        x: 1.5 + Math.floor(rng() * 17),
        y: 1.5 + Math.floor(rng() * 17),
      };
      const occupied = newGrid();
      setCheckpoint(occupied, checkpoint, true);
      const base: (Point & { thunder?: boolean })[] = placeRandom(
        occupied,
        2 + Math.floor(rng() * 6),
      ).map((b) => (rng() < 0.25 ? { ...b, thunder: true } : b));
      const solver = new PathSolver(base, checkpoint);

      const pieces: (Point & { thunder?: boolean })[] = [];
      for (let edit = 0; edit < 14; edit++) {
        const op = rng();
        if (op < 0.55 || pieces.length === 0) {
          const [added] = placeRandom(occupied, 1);
          if (!added) continue;
          pieces.push(added);
        } else if (op < 0.8) {
          const [gone] = pieces.splice(Math.floor(rng() * pieces.length), 1);
          assertExists(gone); // pieces is non-empty on this branch
          setPiece(occupied, gone, false);
        } else {
          const i = Math.floor(rng() * pieces.length);
          const piece = pieces[i];
          assertExists(piece);
          pieces[i] = { ...piece, thunder: !piece.thunder };
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

  await t.test("cachedSolver shares one solver per base board", () => {
    const checkpoint = { x: 9.5, y: 9.5 };
    const a = cachedSolver([{ x: 5, y: 5 }, { x: 12, y: 3 }], checkpoint);
    // Same content, different order: the key is content-addressed.
    const b = cachedSolver([{ x: 12, y: 3 }, { x: 5, y: 5 }], checkpoint);
    assert(a === b);

    // The memoized base result comes back as fresh copies, so a caller can't
    // poison the cache.
    const p1 = a.solve([]);
    const p2 = a.solve([]);
    assertExists(p1);
    assertExists(p2);
    assertEquals(p1, p2);
    assert(p1 !== p2);
    assert(p1[0] !== p2[0]);
  });

  await t.test("covering an endpoint yields no path, not a crash", () => {
    const checkpoint = { x: 9.5, y: 9.5 };
    const solver = new PathSolver([], checkpoint);
    // (9,18) covers the start cell (9,19).
    assertEquals(solver.solve([{ x: 9, y: 18 }]), undefined);
  });
});
