import { assertEquals } from "@std/assert";
import { percentileFromTimeCounts, reverseTween } from "./math.ts";

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

Deno.test("percentileFromTimeCounts", async (t) => {
  await t.step("no other runs returns undefined, not p100", () => {
    assertEquals(percentileFromTimeCounts([], 12.36), undefined);
  });

  await t.step("better than everyone is p100", () => {
    assertEquals(
      percentileFromTimeCounts(
        [{ time: 10, count: 1 }, { time: 15, count: 1 }],
        16,
      ),
      1,
    );
  });

  await t.step("worse than everyone is p0", () => {
    assertEquals(
      percentileFromTimeCounts(
        [{ time: 10, count: 1 }, { time: 15, count: 1 }],
        5,
      ),
      0,
    );
  });

  await t.step("in the middle", () => {
    assertEquals(
      percentileFromTimeCounts(
        [{ time: 10, count: 1 }, { time: 20, count: 1 }],
        15,
      ),
      0.5,
    );
  });

  await t.step("tie splits the count", () => {
    assertEquals(
      percentileFromTimeCounts(
        [{ time: 10, count: 1 }, { time: 15, count: 2 }, {
          time: 20,
          count: 1,
        }],
        15,
      ),
      0.5,
    );
  });
});
