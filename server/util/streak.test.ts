import { test } from "node:test";
import { assertEquals } from "@std/assert";
import { streaks } from "./streak.ts";

test("streaks", async (t) => {
  await t.test("counts the longest run of consecutive days", () => {
    assertEquals(
      streaks(
        ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-05"],
        "2026-09-05",
      ),
      { current: 1, best: 3 },
    );
  });

  await t.test("the current run is the one still live", () => {
    assertEquals(
      streaks(["2026-09-03", "2026-09-04", "2026-09-05"], "2026-09-05"),
      { current: 3, best: 3 },
    );
  });

  await t.test(
    "yesterday still counts, so a day isn't lost to the rollover",
    () => {
      assertEquals(
        streaks(["2026-09-03", "2026-09-04"], "2026-09-05").current,
        2,
      );
    },
  );

  await t.test("an older run is history, not a current streak", () => {
    assertEquals(
      streaks(["2026-09-01", "2026-09-02"], "2026-09-05"),
      { current: 0, best: 2 },
    );
  });

  await t.test("a day ahead of the server's own is still live", () => {
    assertEquals(
      streaks(["2026-09-05", "2026-09-06"], "2026-09-05"),
      { current: 2, best: 2 },
    );
  });

  await t.test("duplicates and disorder don't inflate a run", () => {
    assertEquals(
      streaks(["2026-09-04", "2026-09-03", "2026-09-04"], "2026-09-04"),
      { current: 2, best: 2 },
    );
  });

  await t.test("no days played", () => {
    assertEquals(streaks([], "2026-09-05"), { current: 0, best: 0 });
  });

  await t.test("counts across a month boundary", () => {
    assertEquals(
      streaks(["2026-08-31", "2026-09-01"], "2026-09-01"),
      { current: 2, best: 2 },
    );
  });
});
