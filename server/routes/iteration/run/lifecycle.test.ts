import { assert, assertEquals, assertExists } from "@std/assert";
import { getDailyIteration, getIteration } from "../../../db/iteration.ts";
import { sql } from "../../../db/query.ts";
import { createOrUpdateUser } from "../../../db/user.ts";
import { extractUserId } from "../../../middleware/userid.ts";
import { newIteration } from "../../../util/newIteration.ts";
import { deserializeRun } from "../../../util/run.ts";
import { validateRun } from "../../../util/validateRun.ts";
import { getDailySummary } from "../daily.ts";
import { commitRun } from "./commit.ts";
import { startRun } from "./start.ts";
import { updateRun } from "./update.ts";

// Integration tests for the run lifecycle — the void/ranked/daily state
// machine where most of the audit's bugs lived (1a, 1c, 1g, 3b, the #98
// auto-start). The semantics live in multi-statement SQL (session variables,
// window checks, transactions), which a fake couldn't faithfully emulate, so
// these exercise the REAL route handlers against the real (dev) database:
// each test plays as a throwaway user and deletes it afterwards (its runs
// cascade). Skipped wholesale when SQL_PASSWORD isn't available, so a
// credential-less environment stays green.
const live = !!Deno.env.get("SQL_PASSWORD");

// The routes read the user id off the request the way the middleware leaves
// it, so build a request and run the middleware on it.
const authed = (userId: string) => {
  const req = new Request("http://localhost/api/test", {
    headers: { authorization: userId },
  });
  extractUserId(req, {} as never, undefined);
  return req;
};

// Seeded up front: run.user is a foreign key, and the app always creates the
// user (summary/profile) before any start.
const testUser = async () => {
  const id = `t-${crypto.randomUUID().slice(0, 16)}`;
  await createOrUpdateUser(id);
  return id;
};

type RunRow = {
  iteration: number;
  time: number;
  void: number;
  ranked: number;
  daily: number;
  data: string;
};

const runRows = (user: string) =>
  sql<RunRow[]>`
    SELECT iteration, time, run.void, ranked, daily, data
    FROM run
    WHERE user = ${user}
    ORDER BY created ASC, time ASC;`;

const cleanup = (user: string) => sql`DELETE FROM user WHERE id = ${user};`;

// Age the user's latest run so it reads as started `seconds` ago — how tests
// step past the 60s build window (and the 2s start-race guard) without
// sleeping through them.
const backdate = (user: string, seconds: number) =>
  sql`
    UPDATE run
    SET created = created - INTERVAL ${seconds} SECOND
    WHERE user = ${user}
    ORDER BY created DESC LIMIT 1;`;

// Legal placements on a board: grown greedily so any prefix (and the whole
// set) validates together, letting tests build multi-block mazes.
const freeCells = (
  data: Awaited<ReturnType<typeof getIteration>>,
  n: number,
) => {
  const cells: { x: number; y: number }[] = [];
  for (let y = 2; y <= 16 && cells.length < n; y += 2) {
    for (let x = 2; x <= 16 && cells.length < n; x += 2) {
      if (validateRun(data, [...cells, { x, y }]).ok) cells.push({ x, y });
    }
  }
  if (cells.length < n) throw new Error("board too crowded for test cells");
  return cells;
};

// The daily these tests play (today per UTC — the timeZone every handler call
// passes). Created if the generation cron hasn't reached it on this database.
const todayDaily = (() => {
  let promise: Promise<number> | undefined;
  return () => {
    promise ??= (async () => {
      const now = new Date();
      const parts = [
        now.getUTCFullYear(),
        now.getUTCMonth() + 1,
        now.getUTCDate(),
      ] as const;
      const existing = await getDailyIteration(...parts);
      if (existing) return existing.iteration;
      await newIteration(now);
      return (await getDailyIteration(...parts))!.iteration;
    })();
    return promise;
  };
})();

// Any past iteration works as a free-play board (test runs on it are removed
// by the user cascade). The oldest is safely outside every daily window.
const pastIteration = (() => {
  let promise: Promise<number> | undefined;
  return () => {
    promise ??= sql<{ id: number }[]>`
      SELECT id FROM iteration ORDER BY id ASC LIMIT 1;
    `.then((r) => r[0].id);
    return promise;
  };
})();

Deno.test({
  name: "a daily attempt records ranked and commits on build",
  ignore: !live,
  fn: async () => {
    const user = await testUser();
    const req = authed(user);
    try {
      const started = await startRun.handler(
        { iteration: "daily", timeZone: "UTC" },
        req,
      );
      assert(!("error" in started), "startRun should succeed");

      let rows = await runRows(user);
      assertEquals(rows.length, 1);
      assertEquals(Number(rows[0].ranked), 1, "a daily attempt is ranked");
      assertEquals(Number(rows[0].void), 1, "unbuilt: still void");
      assertEquals(Number(rows[0].daily), 1, "first attempt seeds daily");

      const data = await getIteration(await todayDaily());
      const [cell] = freeCells(data, 1);
      const saved = await updateRun.handler(
        { iteration: data.iteration, blocks: [cell] },
        req,
      );
      assert(!("error" in saved) && !("expired" in saved), "save should land");

      rows = await runRows(user);
      assertEquals(Number(rows[0].void), 0, "a built attempt is committed");
      assertEquals(Number(rows[0].daily), 1, "sole build holds the flag");
    } finally {
      await cleanup(user);
    }
  },
});

Deno.test({
  name: "free play stays void through builds and moves; commits on execution",
  ignore: !live,
  fn: async () => {
    const user = await testUser();
    const req = authed(user);
    try {
      const iteration = await pastIteration();
      const data = await getIteration(iteration);
      const [c0, c1, c2] = freeCells(data, 3);

      const started = await startRun.handler(
        { iteration, timeZone: "UTC", block: c0 },
        req,
      );
      assert(!("error" in started), "free-play start should succeed");

      let rows = await runRows(user);
      assertEquals(Number(rows[0].ranked), 0, "a past day is never ranked");
      assertEquals(Number(rows[0].void), 1, "void until it executes");

      // Build more, then MOVE a block — the 1a regression: a move must not
      // commit the run.
      await updateRun.handler({ iteration, blocks: [c0, c1] }, req);
      await updateRun.handler({ iteration, blocks: [c0, c2] }, req);
      rows = await runRows(user);
      assertEquals(Number(rows[0].void), 1, "builds and moves never commit");
      assertEquals(deserializeRun(rows[0].data).length, 2);

      const committed = await commitRun.handler({ iteration }, req);
      assert(!("error" in committed));
      rows = await runRows(user);
      assertEquals(Number(rows[0].void), 0, "execution commits");
    } finally {
      await cleanup(user);
    }
  },
});

Deno.test({
  name: "a save after the window reports expired and persists nothing (1c)",
  ignore: !live,
  fn: async () => {
    const user = await testUser();
    const req = authed(user);
    try {
      const iteration = await pastIteration();
      const data = await getIteration(iteration);
      const [c0, c1] = freeCells(data, 2);

      await startRun.handler({ iteration, timeZone: "UTC", block: c0 }, req);
      await backdate(user, 120);

      const late = await updateRun.handler(
        { iteration, blocks: [c0, c1] },
        req,
      );
      assert(
        !("error" in late) && "expired" in late && late.expired,
        "a post-window save must say so",
      );

      const rows = await runRows(user);
      assertEquals(
        deserializeRun(rows[0].data).length,
        1,
        "the expired save must not have persisted",
      );
    } finally {
      await cleanup(user);
    }
  },
});

Deno.test({
  name:
    "resume finds the in-progress attempt even when an earlier one holds daily (1g)",
  ignore: !live,
  fn: async () => {
    const user = await testUser();
    const req = authed(user);
    try {
      const data = await getIteration(await todayDaily());
      const [cell] = freeCells(data, 1);

      // Attempt 1: built (committed → holds daily = TRUE), then finished.
      await startRun.handler({ iteration: "daily", timeZone: "UTC" }, req);
      await updateRun.handler(
        { iteration: data.iteration, blocks: [cell] },
        req,
      );
      await backdate(user, 120);

      // Attempt 2: freshly started, empty — it does NOT hold the daily flag
      // (attempt 1's build does), which is exactly what broke the old
      // daily-flag-based resume.
      await startRun.handler({ iteration: "daily", timeZone: "UTC" }, req);
      const rows = await runRows(user);
      assertEquals(rows.length, 2);
      assertEquals(Number(rows[0].daily), 1, "precondition: attempt 1 counts");
      assertEquals(Number(rows[1].daily), 0, "precondition: attempt 2 doesn't");

      const summary = await getDailySummary.handler({ timeZone: "UTC" }, req);
      assert(!("error" in summary));
      assertExists(summary.currentRun, "the fresh attempt must resume");
      assert(summary.currentRun.remainingTime > 0);
      assertEquals(
        summary.ranked.length,
        2,
        "both attempts count as spent/underway",
      );
      assertEquals(
        summary.attempts.length,
        1,
        "the in-progress run stays out of the panel",
      );
    } finally {
      await cleanup(user);
    }
  },
});

Deno.test({
  name: "the counted result always sits on the best ranked build",
  ignore: !live,
  fn: async () => {
    const user = await testUser();
    const req = authed(user);
    try {
      const data = await getIteration(await todayDaily());
      const cells = freeCells(data, 2);

      // Two built attempts with different mazes (durations differ or tie —
      // either way the invariant must hold: exactly one daily = TRUE among
      // ranked runs, on a run whose time is the ranked maximum).
      await startRun.handler({ iteration: "daily", timeZone: "UTC" }, req);
      await updateRun.handler(
        { iteration: data.iteration, blocks: [cells[0]] },
        req,
      );
      await backdate(user, 120);
      await startRun.handler({ iteration: "daily", timeZone: "UTC" }, req);
      await updateRun.handler(
        { iteration: data.iteration, blocks: cells },
        req,
      );

      const rows = await runRows(user);
      const ranked = rows.filter((r) => Number(r.ranked) === 1);
      const flagged = ranked.filter((r) => Number(r.daily) === 1);
      assertEquals(flagged.length, 1, "exactly one counted result");
      const maxTime = Math.max(...ranked.map((r) => r.time));
      assertEquals(
        flagged[0].time,
        maxTime,
        "the counted result is the best ranked build",
      );
    } finally {
      await cleanup(user);
    }
  },
});

Deno.test({
  name: "near-simultaneous starts dedupe to one run (3b)",
  ignore: !live,
  fn: async () => {
    const user = await testUser();
    const req = authed(user);
    try {
      await startRun.handler({ iteration: "daily", timeZone: "UTC" }, req);
      await startRun.handler({ iteration: "daily", timeZone: "UTC" }, req);
      const rows = await runRows(user);
      assertEquals(rows.length, 1, "the race guard drops the duplicate");
    } finally {
      await cleanup(user);
    }
  },
});

Deno.test({
  name: "boot auto-starts the daily and keeps it out of the panel (#98)",
  ignore: !live,
  fn: async () => {
    const user = await testUser();
    const req = authed(user);
    try {
      await todayDaily();
      const summary = await getDailySummary.handler({ timeZone: "UTC" }, req);
      assert(!("error" in summary));
      assertExists(summary.currentRun, "one response boots to a playable run");
      assertEquals(summary.ranked.length, 1, "the started attempt is counted");
      assertEquals(summary.attempts.length, 0, "but not shown as finished");
    } finally {
      await cleanup(user);
    }
  },
});
