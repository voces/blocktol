import { assert, assertEquals } from "@std/assert";
import { createOrUpdateUser } from "../../db/user.ts";
import { sql } from "../../db/query.ts";
import { extractUserId } from "../../middleware/userid.ts";
import { dailyParts } from "../../util/dailyParts.ts";
import { ensureDailyIterationId } from "../../util/newIteration.ts";
import { dayView } from "../dayView.ts";
import { getBoard } from "./board.ts";

// getBoard's free-play gate: only TODAY's own daily is gated, and a locked board
// is a plain { incomplete } rather than an error (the client relays every error
// response to reportClientError, so a routine "not yet" must not be one); every
// other date is always free-playable. Against the real (dev) database — the gate
// lives in SQL. Skipped wholesale when SQL_PASSWORD isn't available.
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
  name: "getBoard: an unfinished daily answers { incomplete }, never an error",
  ignore: !live,
  fn: async () => {
    const user = await testUser();
    try {
      // A fresh user has spent zero of today's three attempts, so free play is
      // locked. UTC matches how the daily is created/looked up in these tests.
      const locked = await getBoard.handler(
        { timeZone: "UTC" },
        authed(user),
      );
      // A plain, non-error "not yet" — nothing for the api proxy to report.
      assert(!("error" in locked), "a locked board must not return an error");
      assertEquals(locked, { incomplete: true });
      // And it stays that way when reached through the day-navigation composite
      // — how a calendar pick asks for it, and how a `/YYYYMMDD`-for-today boot
      // gets its linked slice. Both used to hand the client a 403 to relay.
      const { year, month, day } = dailyParts("UTC");
      const todayId = await ensureDailyIterationId(year, month, day);
      const viaDay = await dayView.handler(
        { iteration: todayId, timeZone: "UTC" },
        authed(user),
      );
      assert(!("error" in viaDay), "dayView must not error on a locked board");
      assertEquals(viaDay.board, { incomplete: true });
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
