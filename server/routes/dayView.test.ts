import { assert, assertEquals } from "@std/assert";
import { createOrUpdateUser } from "../db/user.ts";
import { sql } from "../db/query.ts";
import { extractUserId } from "../middleware/userid.ts";
import { boot } from "./boot.ts";
import { dayView } from "./dayView.ts";

// dayView composes getBoard (non-soft) + standings for one chosen day; this
// checks the bundle carries both slices and that the composed standings is the
// requested iteration's. Hits the dev DB like the run-lifecycle tests;
// self-skips without SQL_PASSWORD.
const live = !!Deno.env.get("SQL_PASSWORD");

const authed = (userId: string) => {
  const req = new Request("http://localhost/api/dayView", {
    headers: { authorization: userId },
  });
  extractUserId(req, {} as never, undefined);
  return req;
};

Deno.test({
  name: "dayView bundles board + standings for a day",
  ignore: !live,
  fn: async () => {
    const id = `t-${crypto.randomUUID().slice(0, 16)}`;
    await createOrUpdateUser(id);
    try {
      // Today's iteration id comes off standings (the ensure-iterations cron
      // generates the day), which dayView then targets by id.
      const b = await boot.handler({ timeZone: "UTC" }, authed(id));
      if ("error" in b) throw new Error("boot returned an auth error");
      if ("error" in b.standings) throw new Error("standings auth error");
      const iteration = b.standings.iteration;

      const r = await dayView.handler(
        { iteration, timeZone: "UTC" },
        authed(id),
      );
      if ("error" in r) throw new Error("dayView returned an auth error");

      assertEquals(Object.keys(r).sort(), ["board", "standings"]);
      // A brand-new user hasn't spent the day's three attempts, so the non-soft
      // board is still gated (a real navigation targets an already-unlocked day)
      // — the composition still bundles it, which is what this asserts.
      assert("error" in r.board, "board gated until free play unlocks");
      assert("daily" in r.standings && "pb" in r.standings);
      assertEquals(
        r.standings.iteration,
        iteration,
        "standings is the requested day",
      );
    } finally {
      await sql`DELETE FROM user WHERE id = ${id};`;
    }
  },
});
