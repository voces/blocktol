import { test } from "node:test";
import { assertEquals } from "@std/assert";
import { decideBoardAccess, iterationDate, ymd } from "./boardAccess.ts";

// The board gate's decision table (see boardAccess.ts).
const base = {
  date: "2026-10-17",
  localToday: "2026-10-17",
  rankedAttempts: 0,
};

test("decideBoardAccess", async (t) => {
  await t.test("a day before the caller's today is open", () => {
    assertEquals(decideBoardAccess({ ...base, date: "2026-10-16" }), "open");
  });

  await t.test("the day that just rolled over is open at once", () => {
    // Free play of yesterday right after local midnight, ranked or not.
    assertEquals(
      decideBoardAccess({ ...base, localToday: "2026-10-18" }),
      "open",
    );
  });

  await t.test("the caller's own today is locked until spent", () => {
    assertEquals(decideBoardAccess({ ...base, rankedAttempts: 2 }), "locked");
    assertEquals(decideBoardAccess({ ...base, rankedAttempts: 3 }), "open");
  });

  await t.test("a future day for the caller is locked", () => {
    // Tomorrow's iteration exists (the gen cron runs a day ahead).
    assertEquals(decideBoardAccess({ ...base, date: "2026-10-18" }), "locked");
  });
});

test("ymd / iterationDate normalize to YYYY-MM-DD", () => {
  assertEquals(ymd({ year: 2026, month: 3, day: 7 }), "2026-03-07");
  // A DATE column reads back bare (direct transport) or as an ISO midnight-Z
  // (proxy); both are the same date.
  assertEquals(iterationDate("2026-03-07"), "2026-03-07");
  assertEquals(iterationDate("2026-03-07T00:00:00.000Z"), "2026-03-07");
});
