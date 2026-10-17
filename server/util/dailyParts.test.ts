import { assertEquals, assertThrows } from "@std/assert";
import { dailyParts } from "./dailyParts.ts";
import { UserError } from "./UserError.ts";

Deno.test("dailyParts", async (t) => {
  // What real browsers report, legacy aliases and Etc/ zones included — none
  // of these may be locked out.
  await t.step("accepts IANA names and aliases", () => {
    for (
      const tz of [
        "America/New_York",
        "Asia/Calcutta",
        "UTC",
        "Etc/GMT+12",
        "Etc/GMT-14",
        "Pacific/Kiritimati",
        "US/Eastern",
      ]
    ) {
      const { year, month, day } = dailyParts(tz);
      assertEquals(
        [year, month, day].every(Number.isInteger),
        true,
        tz,
      );
    }
  });

  // Offset zones stretch a "local day" past the real −12..+14 range.
  // GMT+5 / UTC+5 aren't zones at all to the runtime (RangeError) — rejected
  // either way.
  await t.step("rejects offset and invalid zones", () => {
    for (
      const tz of [
        "-23:59",
        "+23:59",
        "+14:00",
        "+0530",
        "−05:00", // U+2212 minus, which the runtime also takes as an offset
        "GMT+5",
        "UTC+5",
        "5",
        "",
        "Bogus/Zone",
      ]
    ) assertThrows(() => dailyParts(tz), UserError, "invalid timeZone");
  });

  await t.step("the day follows the zone", () => {
    // The two zones are 26h apart, so they never share a calendar day.
    const west = dailyParts("Etc/GMT+12");
    const east = dailyParts("Pacific/Kiritimati");
    assertEquals(
      Date.UTC(east.year, east.month - 1, east.day) >
        Date.UTC(west.year, west.month - 1, west.day),
      true,
    );
  });
});
