import { assert, assertEquals } from "@std/assert";
import { createOrUpdateUser } from "../../db/user.ts";
import { sql } from "../../db/query.ts";
import { extractUserId } from "../../middleware/userid.ts";
import { dailyParts } from "../../util/dailyParts.ts";
import { ensureDailyIterationId } from "../../util/newIteration.ts";
import { dayView } from "../dayView.ts";
import { getIteration } from "../../db/iteration.ts";
import { validateRun } from "../../util/validateRun.ts";
import { getBoard } from "./board.ts";
import { commitRun } from "./run/commit.ts";
import { startRun } from "./run/start.ts";
import { updateRun } from "./run/update.ts";

// The board gate (util/boardAccess.ts) behind getBoard, a free-play start and a
// commit: a locked board is a plain { incomplete } from getBoard rather than an
// error (the client relays every error response to reportClientError, so a
// routine "not yet" must not be one); a closed day is always free-playable; a
// future day is locked everywhere; a westward-rankable day is a recorded
// preview. Against the real (dev) database — the gate reads run/preview rows.
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

// The day after UTC today: its iteration already exists in prod (the gen cron
// runs a day ahead); ensureDailyIterationId backfills it here if not. For a UTC
// caller it is a future day.
const tomorrowUtc = () => {
  const t = new Date(Date.now() + 86_400_000);
  return ensureDailyIterationId(
    t.getUTCFullYear(),
    t.getUTCMonth() + 1,
    t.getUTCDate(),
  );
};

Deno.test({
  name: "board gate: a future day is locked on every surface, layout-free",
  ignore: !live,
  fn: async () => {
    const user = await testUser();
    const req = authed(user);
    try {
      const tomorrow = await tomorrowUtc();
      const board = await getBoard.handler(
        { iteration: tomorrow, timeZone: "UTC" },
        req,
      );
      assertEquals(board, { incomplete: true });

      const started = await startRun.handler(
        { iteration: tomorrow, timeZone: "UTC" },
        req,
      );
      assert("error" in started, "a free-play start must not open tomorrow");
      assert(!("blocks" in started), "and must carry no layout");

      const committed = await commitRun.handler(
        { iteration: tomorrow, blocks: [{ x: 2, y: 2 }], clientId: "t" },
        req,
      );
      assert("error" in committed, "a commit must not land on tomorrow");

      // A save with no run behind it answers expired whatever the maze, so
      // validateRun's reasons can't map the board cell by cell.
      const probe = await updateRun.handler(
        { iteration: tomorrow, blocks: [{ x: 0, y: 0 }] },
        req,
      );
      assertEquals(probe, { expired: true });

      const runs = await sql<{ n: number }[]>`
        SELECT COUNT(1) n FROM run WHERE user = ${user};`;
      assertEquals(Number(runs[0].n), 0, "nothing was written");
    } finally {
      await sql`DELETE FROM user WHERE id = ${user};`;
    }
  },
});

Deno.test({
  name:
    "board gate: a westward-rankable day opens as a preview that forfeits ranking it",
  ignore: !live,
  fn: async () => {
    const user = await testUser();
    const req = authed(user);
    try {
      // The day still current in UTC−12 — rankable there — is always in the
      // past for Kiritimati (UTC+14), 26 hours ahead.
      const { year, month, day } = dailyParts("Etc/GMT+12");
      const westDay = await ensureDailyIterationId(year, month, day);

      const board = await getBoard.handler(
        { iteration: westDay, timeZone: "Pacific/Kiritimati" },
        req,
      );
      assert("blocks" in board, "a preview hands back the board");
      const markers = await sql<{ n: number }[]>`
        SELECT COUNT(1) n FROM preview
        WHERE user = ${user} AND iteration = ${westDay};`;
      assertEquals(Number(markers[0].n), 1, "and records the preview");

      // Now claim the western zone, where that day IS today: no ranked attempt.
      const ranked = await startRun.handler(
        { iteration: "daily", timeZone: "Etc/GMT+12" },
        req,
      );
      assert("error" in ranked, "a previewed daily can't be ranked");
      const runs = await sql<{ n: number }[]>`
        SELECT COUNT(1) n FROM run WHERE user = ${user};`;
      assertEquals(Number(runs[0].n), 0, "no attempt was opened");

      // Free play on it stays open: a commit carries no timezone, but the
      // preview it was granted stands.
      const data = await getIteration(westDay);
      const cell = [{ x: 2, y: 2 }, { x: 4, y: 4 }, { x: 6, y: 6 }]
        .find((c) => validateRun(data, [c]).ok);
      if (cell) {
        const committed = await commitRun.handler(
          { iteration: westDay, blocks: [cell], clientId: crypto.randomUUID() },
          req,
        );
        assert(!("error" in committed), "a granted preview commits");
      }
    } finally {
      await sql`DELETE FROM user WHERE id = ${user};`;
    }
  },
});
