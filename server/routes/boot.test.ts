import { assert, assertEquals } from "@std/assert";
import { createOrUpdateUser } from "../db/user.ts";
import { sql } from "../db/query.ts";
import { extractUserId } from "../middleware/userid.ts";
import { boot } from "./boot.ts";

// The boot endpoint composes six existing handlers in parallel; this checks the
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
        ["board", "list", "notifications", "profile", "standings", "summary"],
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
    } finally {
      await sql`DELETE FROM user WHERE id = ${id};`;
    }
  },
});
