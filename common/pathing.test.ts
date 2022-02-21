import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.126.0/testing/asserts.ts";

import { pathDuration } from "./pathing.ts";
import { Point } from "./types.ts";

Deno.test("pathDuration", async (t) => {
  const assertPath = (
    points: Point[],
    thunders: Point[],
    duration: number,
    slows: number[] = [],
  ) => {
    const [actualDuration, actualSlows] = pathDuration(points, thunders ?? []);
    assert(
      Math.abs(actualDuration - duration) < 1e-9,
      `Expected duration to be ${duration}, got ${actualDuration}`,
    );
    assertEquals(actualSlows, slows);
  };

  await t.step("Without thunders", async (t) => {
    await t.step("zero points", () => assertPath([], [], 0));

    await t.step("one point", () => assertPath([{ x: 0, y: 0 }], [], 0));

    await t.step(
      "two points (vertical down)",
      () =>
        assertPath(
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
        assertPath(
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
        assertPath(
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
        assertPath(
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
        assertPath(
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
        assertPath(
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
    // await t.step("without nearing", () =>
    //   assertPath([
    //     { x: 0, y: 0 },
    //     { x: 100, y: 0 },
    //   ], [
    //     { x: 4.5, y: 9.5 },
    //   ], 20));

    await t.step("walking past", () =>
      assertPath(
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        [
          { x: 4.5, y: -0.5 },
        ],
        24, // slowed for eight seconds by half
        [0.12], //
      ));

    //   await t.step("walking around", () =>
    //   assertPath(
    //     [
    //       { x: 0, y: 0 },
    //       { x: 100, y: 0 },
    //     ],
    //     [
    //       { x: 5, y: 2 },
    //     ],
    //     24, // slowed for eight seconds by half
    //     [0.12],
    //   ));
  });
});
