import { assert, assertEquals } from "@std/assert";
import { createOrUpdateUser } from "../../db/user.ts";
import { sql } from "../../db/query.ts";
import { extractUserId } from "../../middleware/userid.ts";
import { getBoard } from "./board.ts";

// getBoard's free-play gate: only TODAY's own daily is gated (soft mode keeps
// priming from 403ing when it isn't finished); every other date is always
// free-playable. Against the real (dev) database — the gate lives in SQL.
// Skipped wholesale when SQL_PASSWORD isn't available.
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

Deno.test({
  name:
    "getBoard: a past day is free-playable with the daily still outstanding",
  ignore: !live,
  fn: async () => {
    const user = await testUser();
    try {
      // The oldest iteration is safely a past day — not today's daily.
      const [oldest] = await sql<{ id: number }[]>`
        SELECT id FROM iteration ORDER BY id ASC LIMIT 1;`;
      // The user hasn't spent any of today's three attempts, yet a PAST day
      // still stages: only today's OWN daily is gated.
      const board = await getBoard.handler(
        { iteration: oldest.id, timeZone: "UTC" },
        authed(user),
      );
      assert(!("error" in board), "a past day must not 403");
      assert(
        "blocks" in board && "checkpoint" in board,
        "past day returns a real board",
      );
    } finally {
      await sql`DELETE FROM user WHERE id = ${user};`;
    }
  },
});
