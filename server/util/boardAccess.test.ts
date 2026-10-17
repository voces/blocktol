import { assertEquals } from "@std/assert";
import { decideBoardAccess, iterationDate, ymd } from "./boardAccess.ts";

// The board gate's decision table (see boardAccess.ts). `westToday` is the date
// in UTC−12; a day on or after it is still rankable by someone.
const base = {
  date: "2026-10-17",
  westToday: "2026-10-17",
  localToday: "2026-10-17",
  rankedAttempts: 0,
  previewed: false,
};

Deno.test("decideBoardAccess", async (t) => {
  await t.step("a day no one can still rank is open", () => {
    assertEquals(
      decideBoardAccess({ ...base, date: "2026-10-16" }),
      "open",
    );
    // …whatever the caller claims or has spent.
    assertEquals(
      decideBoardAccess({ ...base, date: "2026-10-16", localToday: null }),
      "open",
    );
  });

  await t.step("spent ranked attempts open the board", () => {
    assertEquals(decideBoardAccess({ ...base, rankedAttempts: 3 }), "open");
    assertEquals(
      decideBoardAccess({ ...base, rankedAttempts: 3, localToday: null }),
      "open",
    );
  });

  await t.step("the caller's own today is locked until spent", () => {
    assertEquals(decideBoardAccess({ ...base, rankedAttempts: 2 }), "locked");
  });

  await t.step("a future day for the caller is locked", () => {
    // Tomorrow's iteration exists (the gen cron runs a day ahead).
    assertEquals(
      decideBoardAccess({ ...base, date: "2026-10-18" }),
      "locked",
    );
    // Even when the caller previewed it from a timezone where it was past.
    assertEquals(
      decideBoardAccess({ ...base, date: "2026-10-18", previewed: true }),
      "locked",
    );
  });

  await t.step("a past day still rankable to the west is a preview", () => {
    // Kiritimati (UTC+14) is on the 18th while UTC−12 is still on the 17th.
    assertEquals(
      decideBoardAccess({ ...base, localToday: "2026-10-18" }),
      "preview",
    );
    assertEquals(
      decideBoardAccess({
        ...base,
        localToday: "2026-10-18",
        previewed: true,
      }),
      "preview",
    );
  });

  await t.step("no timezone: only an existing preview opens it", () => {
    assertEquals(decideBoardAccess({ ...base, localToday: null }), "locked");
    assertEquals(
      decideBoardAccess({ ...base, localToday: null, previewed: true }),
      "open",
    );
  });
});

Deno.test("ymd / iterationDate normalize to YYYY-MM-DD", () => {
  assertEquals(ymd({ year: 2026, month: 3, day: 7 }), "2026-03-07");
  // A DATE column reads back bare (direct transport) or as an ISO midnight-Z
  // (proxy); both are the same date.
  assertEquals(iterationDate("2026-03-07"), "2026-03-07");
  assertEquals(iterationDate("2026-03-07T00:00:00.000Z"), "2026-03-07");
});
