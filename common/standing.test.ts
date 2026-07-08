import { assertStrictEquals } from "@std/assert";
import { standing } from "./standing.ts";

Deno.test("standing", async (t) => {
  await t.step("interpolates within the field's range", () => {
    assertStrictEquals(standing(7.5, 5, 10), 0.5);
    assertStrictEquals(standing(5, 5, 10), 0);
    assertStrictEquals(standing(10, 5, 10), 1);
  });

  await t.step("clamps outside the range", () => {
    assertStrictEquals(standing(4, 5, 10), 0);
    assertStrictEquals(standing(11, 5, 10), 1);
  });

  await t.step("a rangeless field stands everyone at 1", () => {
    assertStrictEquals(standing(5, 5, 5), 1);
    // best below min shouldn't happen, but must not divide negatively.
    assertStrictEquals(standing(5, 6, 5), 1);
  });
});
