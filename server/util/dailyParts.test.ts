import { assert, assertEquals, assertMatch, assertThrows } from "@std/assert";
import { dailyDate, dailyParts } from "./dailyParts.ts";

Deno.test("dailyDate", async (t) => {
  await t.step("is a zero-padded YYYY-MM-DD", () => {
    assertMatch(dailyDate("UTC"), /^\d{4}-\d{2}-\d{2}$/);
    // The same shape createIteration binds, so it compares against the stored
    // `created` DATE directly.
    assertEquals(dailyDate("UTC"), new Date().toISOString().slice(0, 10));
  });

  await t.step("follows the caller's local day, not UTC's", () => {
    // Kiritimati (UTC+14) and Niue (UTC-11) are 25 hours apart, so they are
    // never on the same calendar date — the whole reason the profile's board
    // total can't key off the server's own date.
    const ahead = dailyDate("Pacific/Kiritimati");
    const behind = dailyDate("Pacific/Niue");
    assert(ahead > behind, `${ahead} should be later than ${behind}`);
  });

  await t.step("rejects a bad zone the way dailyParts does", () => {
    assertThrows(() => dailyDate("Not/AZone"));
    assertThrows(() => dailyParts("Not/AZone"));
  });
});
