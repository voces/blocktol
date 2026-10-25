import { test } from "node:test";
import { assert, assertEquals } from "@std/assert";
import { createOrUpdateUser } from "../db/user.ts";
import { sql } from "../db/query.ts";
import { extractUserId } from "../middleware/userid.ts";
import { dailyParts } from "../util/dailyParts.ts";
import { boot } from "./boot.ts";

// Checks boot's bundle carries every slice and that boot does NOT start a daily
// attempt, so a background boot can't spend one. Hits the dev DB; self-skips
// without SQL_PASSWORD.
const live = !!Deno.env.get("SQL_PASSWORD");

const authed = (userId: string) => {
  const req = new Request("http://localhost/api/boot", {
    headers: { authorization: userId },
  });
  extractUserId(req, {} as never, undefined);
  return req;
};

test(
  "boot bundles every slice and does not start the daily",
  { skip: !live },
  async () => {
    const id = `t-${crypto.randomUUID().slice(0, 16)}`;
    await createOrUpdateUser(id);
    try {
      const r = await boot.handler({ timeZone: "UTC" }, authed(id));
      if ("error" in r) throw new Error("boot returned an auth error");

      assertEquals(
        Object.keys(r).sort(),
        [
          "board",
          "linked",
          "list",
          "notifications",
          "profile",
          "standings",
          "summary",
        ],
      );

      // A new user: no ranked attempt or open run started, free play locked
      // (board incomplete), no notifications.
      assert(!("error" in r.summary), "summary should succeed");
      assertEquals(r.summary.ranked.length, 0, "boot does not start the daily");
      assertEquals(r.summary.currentRun, null, "no run opened on boot");
      assert(
        "incomplete" in r.board,
        "free play locked until 3 attempts spent",
      );
      assertEquals(r.notifications, { items: [], unread: 0 });
      assert("daily" in r.standings && "pb" in r.standings);
      // list carries the calendar's two mount months: [current, prev].
      assert(
        Array.isArray(r.list) && r.list.length === 2,
        "list is [cur, prev]",
      );
      // No `day` requested → no linked day bundled.
      assertEquals(r.linked, null, "bare boot carries no linked day");
    } finally {
      await sql`DELETE FROM user WHERE id = ${id};`;
    }
  },
);

test("boot with a day bundles that day's linked board + standings", {
  skip: !live,
}, async () => {
  const id = `t-${crypto.randomUUID().slice(0, 16)}`;
  await createOrUpdateUser(id);
  try {
    // Today's iteration exists (ensure-iterations); link to it.
    const { year, month, day } = dailyParts("UTC");
    const r = await boot.handler(
      { timeZone: "UTC", day: [year, month, day] },
      authed(id),
    );
    if ("error" in r) throw new Error("boot returned an auth error");

    assert(r.linked !== null, "linked day resolved");
    assertEquals(
      Object.keys(r.linked).sort(),
      ["board", "iteration", "standings"],
    );
    assertEquals(
      typeof r.linked.iteration,
      "number",
      "linked carries the resolved iteration",
    );
    // The client keys its by-date and by-iteration primes off this.
    assert(
      r.linked.standings && "iteration" in r.linked.standings &&
        r.linked.standings.iteration === r.linked.iteration,
      "linked standings is the resolved day",
    );

    // A never-generated far-past date gives linked: null.
    const none = await boot.handler(
      { timeZone: "UTC", day: [2000, 1, 1] },
      authed(id),
    );
    if ("error" in none) throw new Error("boot returned an auth error");
    assertEquals(none.linked, null, "unknown date → linked null");
  } finally {
    await sql`DELETE FROM user WHERE id = ${id};`;
  }
});
