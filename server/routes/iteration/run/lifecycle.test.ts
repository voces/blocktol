import { test } from "node:test";
import { live } from "../../../db/liveTests.ts";
import { assert, assertEquals, assertExists } from "@std/assert";
import { hasLength } from "../../../../common/typeguards.ts";
import { getDailyIteration, getIteration } from "../../../db/iteration.ts";
import { sql } from "../../../db/query.ts";
import { createOrUpdateUser } from "../../../db/user.ts";
import { extractUserId } from "../../../middleware/userid.ts";
import { newIteration } from "../../../util/newIteration.ts";
import { deserializeRun } from "../../../util/run.ts";
import { validateRun } from "../../../util/validateRun.ts";
import { getDailySummary } from "../daily.ts";
import { commitRun } from "./commit.ts";
import { setRunPinned } from "./pin.ts";
import { startRun } from "./start.ts";
import { updateRun } from "./update.ts";

// Integration tests for the run lifecycle (the void/ranked/daily state
// machine). The semantics live in multi-statement SQL (session variables,
// window checks, transactions) that a fake can't emulate, so these run the REAL
// handlers against the dev database. Each test plays as a throwaway user and
// deletes it afterwards (runs cascade). Skipped without SQL_PASSWORD.

// Handlers read the user id the way extractUserId leaves it, so run that
// middleware on the request.
const authed = (userId: string) => {
  const req = new Request("http://localhost/api/test", {
    headers: { authorization: userId },
  });
  void extractUserId(req, {} as never, undefined);
  return req;
};

// Seeded up front: run.user is a foreign key and the app creates the user
// before any start.
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

// The user's earliest run.
const firstRun = async (user: string) => {
  const [run] = await runRows(user);
  assertExists(run, "a run row");
  return run;
};

const cleanup = (user: string) => sql`DELETE FROM user WHERE id = ${user};`;

// The pinned flags of the user's runs, in runRows order.
const pinnedFlags = (user: string) =>
  sql<{ pinned: number }[]>`
    SELECT run.pinned
    FROM run
    WHERE user = ${user}
    ORDER BY created ASC, time ASC;`.then((r) =>
    r.map((x) => Number(x.pinned))
  );

// Age the user's latest run as if started `seconds` ago, to step past the 60s
// window and the 2s start-race guard without sleeping.
const backdate = (user: string, seconds: number) =>
  sql`
    UPDATE run
    SET created = created - INTERVAL ${seconds} SECOND
    WHERE user = ${user}
    ORDER BY created DESC LIMIT 1;`;

// Legal placements, grown greedily so any prefix (and the whole set) validates.
const freeCells = <N extends number>(
  data: Awaited<ReturnType<typeof getIteration>>,
  n: N,
) => {
  const cells: { x: number; y: number }[] = [];
  for (let y = 2; y <= 16 && cells.length < n; y += 2) {
    for (let x = 2; x <= 16 && cells.length < n; x += 2) {
      if (validateRun(data, [...cells, { x, y }]).ok) cells.push({ x, y });
    }
  }
  if (!hasLength(cells, n)) throw new Error("board too crowded for test cells");
  return cells;
};

// The daily these tests play (today per UTC, the timeZone every call passes),
// created if the gen cron hasn't reached it on this database.
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
      const created = await getDailyIteration(...parts);
      assertExists(created, "the daily just generated");
      return created.iteration;
    })();
    return promise;
  };
})();

// Any past iteration works as a free-play board; the oldest is outside every
// daily window.
const pastIteration = (() => {
  let promise: Promise<number> | undefined;
  return () => {
    promise ??= sql<{ id: number }[]>`
      SELECT id FROM iteration ORDER BY id ASC LIMIT 1;
    `.then(([r]) => {
      assertExists(r, "an iteration on this database");
      return r.id;
    });
    return promise;
  };
})();

test(
  "a daily attempt records ranked and commits on build",
  { skip: !live },
  async () => {
    const user = await testUser();
    const req = authed(user);
    try {
      const started = await startRun.handler(
        { iteration: "daily", timeZone: "UTC" },
        req,
      );
      assert(!("error" in started), "startRun should succeed");

      assertEquals((await runRows(user)).length, 1);
      let run = await firstRun(user);
      assertEquals(Number(run.ranked), 1, "a daily attempt is ranked");
      assertEquals(Number(run.void), 1, "unbuilt: still void");
      assertEquals(Number(run.daily), 1, "first attempt seeds daily");

      const data = await getIteration(await todayDaily());
      const [cell] = freeCells(data, 1);
      const saved = await updateRun.handler(
        { iteration: data.iteration, blocks: [cell] },
        req,
      );
      assert(!("error" in saved) && !("expired" in saved), "save should land");

      run = await firstRun(user);
      assertEquals(Number(run.void), 0, "a built attempt is committed");
      assertEquals(Number(run.daily), 1, "sole build holds the flag");
    } finally {
      await cleanup(user);
    }
  },
);

test("free play stays void through builds and moves; commits on execution", {
  skip: !live,
}, async () => {
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

    let run = await firstRun(user);
    assertEquals(Number(run.ranked), 0, "a past day is never ranked");
    assertEquals(Number(run.void), 1, "void until it executes");

    // Build more, then MOVE a block (1a): a move must not commit the run.
    await updateRun.handler({ iteration, blocks: [c0, c1] }, req);
    await updateRun.handler({ iteration, blocks: [c0, c2] }, req);
    run = await firstRun(user);
    assertEquals(Number(run.void), 1, "builds and moves never commit");
    assertEquals(deserializeRun(run.data).length, 2);

    const committed = await commitRun.handler({ iteration }, req);
    assert(!("error" in committed));
    run = await firstRun(user);
    assertEquals(Number(run.void), 0, "execution commits");
  } finally {
    await cleanup(user);
  }
});

test("commit-only free play inserts one non-void run with the server's time", {
  skip: !live,
}, async () => {
  const user = await testUser();
  const req = authed(user);
  try {
    const iteration = await pastIteration();
    const data = await getIteration(iteration);
    const cells = freeCells(data, 2);
    const expected = validateRun(data, cells);
    assert(expected.ok);

    // The current client: the whole maze arrives at commit.
    const committed = await commitRun.handler(
      { iteration, blocks: cells, clientId: crypto.randomUUID() },
      req,
    );
    assert(!("error" in committed), "commit-only free play should succeed");

    assertEquals(
      (await runRows(user)).length,
      1,
      "one row, inserted at commit",
    );
    const run = await firstRun(user);
    assertEquals(Number(run.void), 0, "inserted already non-void");
    assertEquals(Number(run.ranked), 0, "free play is never ranked");
    assertEquals(Number(run.daily), 0, "free play never counts as daily");
    assertEquals(
      run.time,
      expected.duration,
      "the server recomputes the time from the maze",
    );
    assertEquals(deserializeRun(run.data).length, cells.length);
  } finally {
    await cleanup(user);
  }
});

test("commitRun returns the server-stored created so the run can be pinned", {
  skip: !live,
}, async () => {
  const user = await testUser();
  const req = authed(user);
  try {
    const iteration = await pastIteration();
    const data = await getIteration(iteration);
    const cells = freeCells(data, 2);

    // Commit the way the current client does.
    const committed = await commitRun.handler(
      { iteration, blocks: cells, clientId: crypto.randomUUID() },
      req,
    );
    assert(!("error" in committed), "commit-only free play should succeed");

    // The client shows the just-executed run optimistically before any
    // refetch. For a pin on that row to persist, the commit must return the
    // server-assigned `created` (the second-precision ms the pin query
    // matches on), not a client Date.now() stamp.
    assertExists(committed.created, "commit returns the run's created");
    assertEquals(
      committed.created % 1000,
      0,
      "the returned created is the DB's second-precision value",
    );

    // A millisecond-precision client stamp can't match the server's
    // second-precision row, so the pin silently no-ops.
    const clientStamp = committed.created + 123;
    const stale = await setRunPinned.handler(
      { iteration, created: [clientStamp], pinned: true },
      req,
    );
    assert(!("error" in stale));
    assertEquals(
      await pinnedFlags(user),
      [0],
      "a mis-stamped pin matches no row",
    );

    // The created the commit returned matches exactly, so the pin lands.
    const pinned = await setRunPinned.handler(
      { iteration, created: [committed.created], pinned: true },
      req,
    );
    assert(!("error" in pinned));
    assertEquals(
      await pinnedFlags(user),
      [1],
      "pinning with the server-returned created persists",
    );
  } finally {
    await cleanup(user);
  }
});

test("a free-play commit is idempotent on client_id (deploy-retry safe)", {
  skip: !live,
}, async () => {
  const user = await testUser();
  const req = authed(user);
  try {
    const iteration = await pastIteration();
    const data = await getIteration(iteration);
    const [cell] = freeCells(data, 1);
    const clientId = crypto.randomUUID();

    // The same commit twice (a retry after a dropped connection) leaves one
    // row; a fresh id is a new run.
    await commitRun.handler({ iteration, blocks: [cell], clientId }, req);
    await commitRun.handler({ iteration, blocks: [cell], clientId }, req);
    assertEquals(
      (await runRows(user)).length,
      1,
      "a retried commit with the same id inserts nothing new",
    );

    await commitRun.handler(
      { iteration, blocks: [cell], clientId: crypto.randomUUID() },
      req,
    );
    assertEquals(
      (await runRows(user)).length,
      2,
      "a different id is a new run",
    );
  } finally {
    await cleanup(user);
  }
});

test("a save after the window reports expired and persists nothing (1c)", {
  skip: !live,
}, async () => {
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

    assertEquals(
      deserializeRun((await firstRun(user)).data).length,
      1,
      "the expired save must not have persisted",
    );
  } finally {
    await cleanup(user);
  }
});

test(
  "resume finds the in-progress attempt even when an earlier one holds daily (1g)",
  { skip: !live },
  async () => {
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

      // Attempt 2: freshly started, empty; attempt 1 holds the daily flag, so
      // resume must not key off it.
      await startRun.handler({ iteration: "daily", timeZone: "UTC" }, req);
      const rows = await runRows(user);
      assert(hasLength(rows, 2), `two attempts, not ${rows.length}`);
      assertEquals(Number(rows[0].daily), 1, "precondition: attempt 1 counts");
      assertEquals(
        Number(rows[1].daily),
        0,
        "precondition: attempt 2 doesn't",
      );

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
);

test(
  "the counted result always sits on the best ranked build",
  { skip: !live },
  async () => {
    const user = await testUser();
    const req = authed(user);
    try {
      const data = await getIteration(await todayDaily());
      const cells = freeCells(data, 2);

      // Two built attempts with different mazes. Whether durations differ or
      // tie, exactly one ranked run has daily = TRUE, at the ranked maximum.
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
        flagged[0]?.time,
        maxTime,
        "the counted result is the best ranked build",
      );
    } finally {
      await cleanup(user);
    }
  },
);

test(
  "near-simultaneous starts dedupe to one run (3b)",
  { skip: !live },
  async () => {
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
);

test(
  "boot does not start the daily; an open run stays out of the panel (#98)",
  { skip: !live },
  async () => {
    const user = await testUser();
    const req = authed(user);
    try {
      await todayDaily();

      // The summary opens no run and counts no attempt, so a background boot
      // can't spend one.
      const boot = await getDailySummary.handler({ timeZone: "UTC" }, req);
      assert(!("error" in boot));
      assertEquals(boot.currentRun, null, "boot opens no run");
      assertEquals(boot.ranked.length, 0, "boot starts no attempt");

      // After startRun the summary resumes it as currentRun and counts it in
      // ranked, but keeps it out of the finished-attempts panel (#98).
      await startRun.handler({ iteration: "daily", timeZone: "UTC" }, req);
      const summary = await getDailySummary.handler({ timeZone: "UTC" }, req);
      assert(!("error" in summary));
      assertExists(summary.currentRun, "the started attempt resumes as a run");
      assertEquals(summary.ranked.length, 1, "the started attempt is counted");
      assertEquals(summary.attempts.length, 0, "but not shown as finished");
    } finally {
      await cleanup(user);
    }
  },
);

// The trace column of the user's runs, in runRows order.
const traces = (user: string) =>
  sql<{ trace: string | null }[]>`
    SELECT trace
    FROM run
    WHERE user = ${user}
    ORDER BY created ASC, time ASC;`.then((r) => r.map((x) => x.trace));

test("a ranked save appends its edit batch to the trace; free play has none", {
  skip: !live,
}, async () => {
  const user = await testUser();
  const req = authed(user);
  try {
    const data = await getIteration(await todayDaily());
    const [c0, c1] = freeCells(data, 2);

    await startRun.handler({ iteration: "daily", timeZone: "UTC" }, req);
    await updateRun.handler({
      iteration: data.iteration,
      blocks: [c0],
      trace: { p: "pg1", e: [[0, 800, "p", c0.x, c0.y]] },
    }, req);
    // A malformed trace still saves, and records a line without a batch.
    const saved = await updateRun.handler({
      iteration: data.iteration,
      blocks: [c0, c1],
      trace: { p: "pg1", e: [["bogus"]] },
    }, req);
    assert(!("error" in saved) && !("expired" in saved), "save must land");

    const [trace] = await traces(user);
    assertExists(trace, "the attempt keeps a trace");
    const lines = trace.trim().split("\n").map((l) => JSON.parse(l));
    assertEquals(lines.length, 2);
    assert(lines[0].s >= 0 && lines[0].s < 61_000, "server ms since start");
    assertEquals(lines[0].n, 1);
    assertEquals(lines[0].p, "pg1");
    assertEquals(lines[0].e, [[0, 800, "p", c0.x, c0.y]]);
    assertEquals(lines[1].n, 2);
    assertEquals(lines[1].p, undefined, "no usable batch");

    // A save after the window keeps the trace as it was.
    await backdate(user, 120);
    await updateRun.handler({
      iteration: data.iteration,
      blocks: [c0],
      trace: { p: "pg1", e: [[1, 5, "d", c1.x, c1.y]] },
    }, req);
    const [after] = await traces(user);
    assertExists(after, "the attempt keeps its trace");
    assertEquals(
      after.trim().split("\n").length,
      2,
      "an expired save appends nothing",
    );

    const past = await pastIteration();
    const pastData = await getIteration(past);
    const [f0] = freeCells(pastData, 1);
    await startRun.handler(
      { iteration: past, timeZone: "UTC", block: f0 },
      req,
    );
    assertEquals((await traces(user))[1], null, "free play keeps no trace");
  } finally {
    await cleanup(user);
  }
});
