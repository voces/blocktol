import { test } from "node:test";
import { assert, assertEquals } from "@std/assert";
import { createOrUpdateUser } from "../db/user.ts";
import { sql } from "../db/query.ts";
import { extractUserId } from "../middleware/userid.ts";
import { boot } from "./boot.ts";
import { dayView } from "./dayView.ts";

// Checks dayView's bundle carries both slices and that its standings is the
// requested iteration's. Hits the dev DB; self-skips without SQL_PASSWORD.
const live = !!Deno.env.get("SQL_PASSWORD");

const authed = (userId: string) => {
  const req = new Request("http://localhost/api/dayView", {
    headers: { authorization: userId },
  });
  extractUserId(req, {} as never, undefined);
  return req;
};

test(
  "dayView bundles board + standings for a day",
  { skip: !live },
  async () => {
    const id = `t-${crypto.randomUUID().slice(0, 16)}`;
    await createOrUpdateUser(id);
    try {
      // Today's iteration id comes off boot's standings; dayView targets it.
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
      // A new user hasn't spent three attempts, so the board is gated: a plain
      // { incomplete }, never an error. The bundle still carries it.
      assert(!("error" in r.board), "a gated board is not an error");
      assertEquals(r.board, { incomplete: true });
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
);
