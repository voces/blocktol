import { test } from "node:test";
import { live } from "../../db/liveTests.ts";
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
// commit: a locked board is a plain { incomplete } from getBoard, not an error;
// a past day is always free-playable; a future day is locked everywhere. Runs
// against the dev database (the gate reads run rows); skipped without
// SQL_PASSWORD.

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

test("getBoard: an unfinished daily answers { incomplete }, never an error", {
  skip: !live,
}, async () => {
  const user = await testUser();
  try {
    // A fresh user has spent no attempts, so free play is locked.
    const locked = await getBoard.handler(
      { timeZone: "UTC" },
      authed(user),
    );
    // Not an error: nothing for the client's api proxy to report.
    assert(!("error" in locked), "a locked board must not return an error");
    assertEquals(locked, { incomplete: true });
    // Same through dayView (a calendar pick; a `/YYYYMMDD`-for-today boot's
    // linked slice).
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
});

test("getBoard: a past day is free-playable with the daily still outstanding", {
  skip: !live,
}, async () => {
  const user = await testUser();
  try {
    // The oldest iteration is a past day.
    const [oldest] = await sql<{ id: number }[]>`
        SELECT id FROM iteration ORDER BY id ASC LIMIT 1;`;
    // No attempts spent, yet a PAST day stages: only the caller's own today
    // is gated.
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
});

// The day after UTC today: a future day for a UTC caller. The gen cron runs a
// day ahead in prod; ensureDailyIterationId backfills it here if missing.
const tomorrowUtc = () => {
  const t = new Date(Date.now() + 86_400_000);
  return ensureDailyIterationId(
    t.getUTCFullYear(),
    t.getUTCMonth() + 1,
    t.getUTCDate(),
  );
};

test("board gate: a future day is locked on every surface, layout-free", {
  skip: !live,
}, async () => {
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

    // A save with no run answers expired whatever the maze, so validateRun's
    // reasons can't map the board.
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
});

test("board gate: the day that just rolled over is free-playable at once", {
  skip: !live,
}, async () => {
  const user = await testUser();
  const req = authed(user);
  try {
    // UTC yesterday: past for a UTC caller though often still rankable
    // further west. It opens with no ranked attempts.
    const t = new Date(Date.now() - 86_400_000);
    const yesterday = await ensureDailyIterationId(
      t.getUTCFullYear(),
      t.getUTCMonth() + 1,
      t.getUTCDate(),
    );

    const board = await getBoard.handler(
      { iteration: yesterday, timeZone: "UTC" },
      req,
    );
    assert("blocks" in board, "yesterday's board is served");

    const data = await getIteration(yesterday);
    const cell = [{ x: 2, y: 2 }, { x: 4, y: 4 }, { x: 6, y: 6 }]
      .find((c) => validateRun(data, [c]).ok);
    if (cell) {
      const committed = await commitRun.handler(
        {
          iteration: yesterday,
          blocks: [cell],
          clientId: crypto.randomUUID(),
          timeZone: "UTC",
        },
        req,
      );
      assert(!("error" in committed), "and a free-play run on it commits");
    }
  } finally {
    await sql`DELETE FROM user WHERE id = ${user};`;
  }
});
