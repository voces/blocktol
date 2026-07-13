import { assert, assertEquals } from "@std/assert";
import { createOrUpdateUser } from "../db/user.ts";
import { sql } from "../db/query.ts";
import { extractUserId } from "../middleware/userid.ts";
import { dailyParts } from "../util/dailyParts.ts";
import { boot } from "./boot.ts";

// The boot endpoint composes existing handlers in parallel; this checks the
// bundle carries every slice and that composition preserves the load-bearing
// side effect — getDailySummary auto-starting the next ranked attempt — through
// boot. Hits the dev DB like the run-lifecycle tests; self-skips without
// SQL_PASSWORD.
const live = !!Deno.env.get("SQL_PASSWORD");

const authed = (userId: string) => {
  const req = new Request("http://localhost/api/boot", {
    headers: { authorization: userId },
  });
  extractUserId(req, {} as never, undefined);
  return req;
};

Deno.test({
  name: "boot bundles every slice and auto-starts the daily",
  ignore: !live,
  fn: async () => {
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

      // A brand-new user: the composed getDailySummary auto-started attempt 1
      // (so it counts as underway), free play is still locked (board incomplete),
      // and nothing is in the notifications feed yet.
      assert(!("error" in r.summary), "summary should succeed");
      assertEquals(r.summary.ranked.length, 1, "boot auto-started the daily");
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
});

Deno.test({
  name: "boot with a day bundles that day's linked board + standings",
  ignore: !live,
  fn: async () => {
    const id = `t-${crypto.randomUUID().slice(0, 16)}`;
    await createOrUpdateUser(id);
    try {
      // Today exists (the auto-start in the bare boot ensures its iteration);
      // point the day-link at it and confirm boot resolves + bundles it.
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
      // The linked standings is that day's — the client keys its by-date and
      // by-iteration primes off it.
      assert(
        r.linked.standings && "iteration" in r.linked.standings &&
          r.linked.standings.iteration === r.linked.iteration,
        "linked standings is the resolved day",
      );

      // A never-generated far-past date resolves to nothing → linked: null, and
      // the client falls through to its own fetch.
      const none = await boot.handler(
        { timeZone: "UTC", day: [2000, 1, 1] },
        authed(id),
      );
      if ("error" in none) throw new Error("boot returned an auth error");
      assertEquals(none.linked, null, "unknown date → linked null");
    } finally {
      await sql`DELETE FROM user WHERE id = ${id};`;
    }
  },
});
