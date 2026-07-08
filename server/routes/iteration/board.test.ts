import { assert, assertEquals } from "@std/assert";
import { createOrUpdateUser } from "../../db/user.ts";
import { sql } from "../../db/query.ts";
import { extractUserId } from "../../middleware/userid.ts";
import { getBoard } from "./board.ts";

// getBoard's soft mode: priming today's board on boot must not 403 (and fire a
// spurious client-error report) when the daily isn't finished yet. Against the
// real (dev) database — the attempts gate lives in SQL. Skipped wholesale when
// SQL_PASSWORD isn't available.
const live = !!Deno.env.get("SQL_PASSWORD");

const authed = (userId: string) => {
  const req = new Request("http://localhost/api/test", {
    headers: { authorization: userId },
  });
  extractUserId(req, {} as never, undefined);
  return req;
};

const testUser = async () => {
  const id = `t-${crypto.randomUUID().slice(0, 16)}`;
  await createOrUpdateUser(id);
  return id;
};

Deno.test({
  name: "getBoard: soft answers { incomplete } where the default 403s",
  ignore: !live,
  fn: async () => {
    const user = await testUser();
    try {
      // A fresh user has spent zero of today's three attempts, so free play is
      // locked. UTC matches how the daily is created/looked up in these tests.
      const hard = await getBoard.handler(
        { timeZone: "UTC" },
        authed(user),
      );
      assert("error" in hard, "unfinished daily should 403 without soft");
      assertEquals(hard.status, 403);

      const soft = await getBoard.handler(
        { timeZone: "UTC", soft: true },
        authed(user),
      );
      // Soft: a plain, non-error "not yet" — nothing for the proxy to report.
      assert(!("error" in soft), "soft must not return an error");
      assertEquals(soft, { incomplete: true });
    } finally {
      await sql`DELETE FROM user WHERE id = ${user};`;
    }
  },
});
