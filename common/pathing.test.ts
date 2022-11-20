import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.165.0/testing/asserts.ts";

import { pathDuration, Slow } from "./pathing.ts";
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
