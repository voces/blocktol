import { assertEquals } from "std/testing/asserts.ts";
import { reverseTween } from "./math.ts";

Deno.test("reverseTween", async (t) => {
  await t.step("no data, but higher than min", () => {
    assertEquals(reverseTween([], 2, 1), 1);
  });

  await t.step("no data, but lower than min", () => {
    assertEquals(reverseTween([], 1, 2), 0);
  });

  await t.step("value is less than lowest & min", () => {
    assertEquals(reverseTween([3, 4], 1, 2), 0);
  });

  await t.step("value is less than lowest", () => {
    // (value - min) / (nextValue - min) / length => (2-1)/(3-1)/2
    assertEquals(reverseTween([3, 4], 2, 1), 0.25); // half way from min to lowest
  });

  await t.step("value is equal to lowest", () => {
    // (index + 0.5) / length => (0+0.5)/2
    assertEquals(reverseTween([1, 2], 1, 1), 0.25);
  });

  await t.step("value is equal to multiple lowests", () => {
    // (firstIndex + lastIndex + 1) / 2 / length => (0+2+1)/2/5
    assertEquals(reverseTween([1, 1, 1, 2, 3], 1, 1), 0.3);
  });

  await t.step("value is equal to mid value", () => {
    // (index + 0.5) / length => (1+0.5)/5
    assertEquals(reverseTween([1, 2, 3, 4, 5], 2, 1), 0.3);
  });

  await t.step("value is equal to multiple mid values", () => {
    // (firstIndex + lastIndex + 1) / 2 / length => (1+2+1)/2/4
    assertEquals(reverseTween([1, 2, 2, 3], 2, 1), 0.5);
  });

  await t.step("value is between two mid values", () => {
    // (prevIndex + (value - prevValue) / (nextValue - prevValue) + 1) / length => (1+(3-2)/(4-2)+1)/4
    assertEquals(reverseTween([1, 2, 4, 4], 3, 1), 0.625);
  });
  await t.step("value is equal to multiple highests", () => {
    assertEquals(reverseTween([1, 2, 2], 2, 1), 1);
  });

  await t.step("value is equal to highest", () => {
    assertEquals(reverseTween([1, 2], 2, 1), 1);
  });

  await t.step("value is greater than highest", () => {
    assertEquals(reverseTween([1, 2], 3, 1), 1);
  });
});
