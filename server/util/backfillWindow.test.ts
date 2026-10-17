import { assertEquals } from "@std/assert";
import { backfillWindow, utcDay } from "./backfillWindow.ts";

const DAY = 1_000 * 60 * 60 * 24;
const today = Date.UTC(2026, 9, 17);
const floor = Date.UTC(2025, 0, 1);

Deno.test("backfillWindow", async (t) => {
  await t.step("tomorrow is the latest day", () => {
    assertEquals(backfillWindow(today + DAY, floor, today), "ok");
    assertEquals(backfillWindow(today + 2 * DAY, floor, today), "future");
  });

  await t.step("a gap between the floor and today is backfilled", () => {
    assertEquals(backfillWindow(floor, floor, today), "ok");
    assertEquals(backfillWindow(Date.UTC(2026, 3, 1), floor, today), "ok");
    assertEquals(backfillWindow(today, floor, today), "ok");
  });

  await t.step("nothing before the earliest iteration", () => {
    assertEquals(backfillWindow(floor - DAY, floor, today), "past");
    assertEquals(backfillWindow(Date.UTC(1000, 0, 1), floor, today), "past");
  });

  await t.step("an empty table allows only yesterday onward", () => {
    assertEquals(backfillWindow(today - DAY, null, today), "ok");
    assertEquals(backfillWindow(today, null, today), "ok");
    assertEquals(backfillWindow(today - 2 * DAY, null, today), "past");
  });

  await t.step("yesterday is allowed even above the floor", () => {
    // A fresh DB seeded only with today: players west of UTC are on yesterday.
    assertEquals(backfillWindow(today - DAY, today, today), "ok");
    assertEquals(backfillWindow(today - 2 * DAY, today, today), "past");
  });
});

Deno.test("utcDay", () => {
  assertEquals(utcDay(2026, 10, 17), today);
  assertEquals(utcDay(2024, 2, 29), Date.UTC(2024, 1, 29));
  assertEquals(utcDay(2026, 2, 31), null);
  assertEquals(utcDay(2026, 13, 1), null);
  assertEquals(utcDay(2026, 1.5, 1), null);
  assertEquals(utcDay(NaN, 1, 1), null);
  // Date.UTC maps two-digit years onto 19xx — not the day asked for.
  assertEquals(utcDay(99, 1, 1), null);
});
