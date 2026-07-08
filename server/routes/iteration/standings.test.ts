import { assert, assertEquals } from "@std/assert";
import { sql } from "../../db/query.ts";
import { createOrUpdateUser } from "../../db/user.ts";
import { extractUserId } from "../../middleware/userid.ts";
import { standings } from "./standings.ts";

// Integration test for the standings route against the real (dev) database —
// the per-user-best/void/daily filtering lives in SQL, so a fake couldn't
// prove it. Plays out on a throwaway iteration with throwaway users, all
// removed afterwards (runs cascade from both). Skipped wholesale when
// SQL_PASSWORD isn't available, so a credential-less environment stays green.
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

// An isolated iteration nothing else plays on, so the field is exactly what
// the test seeds. Inserted directly (the createIteration path generates a
// whole board this test never renders).
const testIteration = () =>
  sql<{ insertId: number }>`
    INSERT INTO iteration (created, bricks, power, checkpoint_x, checkpoint_y, min)
    VALUES ('2001-01-01', 1, 0, 9.5, 9.5, 10);
  `.then((r) => r.insertId);

const seedRun = (
  user: string,
  iteration: number,
  time: number,
  { daily = true, voided = false } = {},
) =>
  sql`
    INSERT INTO run (user, iteration, time, daily, void, data)
    VALUES (${user}, ${iteration}, ${time}, ${daily}, ${voided}, '');
  `;

Deno.test({
  name: "standings returns both boards, ranked and windowed, in one response",
  ignore: !live,
  fn: async () => {
    const iteration = await testIteration();
    const users = await Promise.all(
      Array.from({ length: 5 }, () => testUser()),
    );
    const [leader, tiedA, tiedB, fourth, viewer] = users;
    try {
      await seedRun(leader, iteration, 40);
      // A player ranks by their BEST daily run — the lower one must not count.
      await seedRun(leader, iteration, 35);
      await seedRun(tiedA, iteration, 38.5);
      await seedRun(tiedB, iteration, 38.5);
      await seedRun(fourth, iteration, 36);
      await seedRun(viewer, iteration, 34);
      // Neither a voided daily run nor a free-play run belongs on the daily
      // board, however good — but a free-play run DOES count as the viewer's
      // best build that day, so their PB is 60, not 34.
      await seedRun(viewer, iteration, 50, { voided: true });
      await seedRun(viewer, iteration, 60, { daily: false });

      const r = await standings.handler({ iteration }, authed(viewer));
      assert(!("error" in r), "expected a standings payload");

      assertEquals(r.iteration, iteration);
      assertEquals(r.day, [2001, 1, 1]);
      // Unrated, but its close is long past — the field is frozen, so it reads
      // final with no countdown. `final`/`closesAt` are top-level day facts.
      assertEquals(r.final, true);
      assertEquals(r.closesAt, null);

      // --- Daily board: ranked by each player's best daily run ---
      assertEquals(r.daily.players, 5);
      assertEquals(r.daily.me, {
        rank: 5,
        tied: false,
        time: 34,
        // The daily row's secondary is the player's best build that day — the
        // viewer's 60 free-play run.
        secondary: 60,
        record: null,
        percentile: 0,
      });
      // Competition ranking off each player's best: 40, T2 38.5, T2 38.5,
      // 4th 36, 5th 34 — a five-player field shows whole (podium ∪ viewer±1).
      assertEquals(r.daily.rows.map((row) => row.rank), [1, 2, 2, 4, 5]);
      assertEquals(r.daily.rows.map((row) => row.time), [
        40,
        38.5,
        38.5,
        36,
        34,
      ]);
      // Each daily row carries the player's best build that day as secondary;
      // only the viewer's differs from their daily time (the 60 free-play run).
      assertEquals(r.daily.rows.map((row) => row.secondary), [
        40,
        38.5,
        38.5,
        36,
        60,
      ]);
      assertEquals(
        r.daily.rows.map((row) => row.tied),
        [false, true, true, false, false],
      );
      assertEquals(
        r.daily.rows.map((row) => row.record),
        ["beat", null, null, null, null],
      );
      assertEquals(r.daily.rows.map((row) => row.you), [
        false,
        false,
        false,
        false,
        true,
      ]);
      assertEquals(r.daily.rows.every((row) => row.gapBefore === 0), true);

      for (const row of r.daily.rows) {
        // The id is the bearer credential — a row must never carry it, only
        // the display name and the derived avatar hue.
        assert(!("user" in row), "row must not expose the player's id");
        assert(typeof row.name === "string" && row.name.length > 0);
        assert(Number.isInteger(row.hue) && row.hue >= 0 && row.hue < 360);
        assert(row.at > 0);
      }

      // --- PB board: SAME response, the same players re-ranked by best build ---
      // The viewer's 60 free-play run is their best that day, so they jump to
      // #1 (their ranked day best was only 5th); each row's secondary is that
      // day's ranked time. Same five players, same count — just re-sorted.
      assertEquals(r.pb.players, 5);
      assertEquals(r.pb.me, {
        rank: 1,
        tied: false,
        time: 60,
        secondary: 34,
        record: "beat",
        percentile: 1,
      });
      // PB order: viewer 60, leader 40, {tiedA,tiedB} 38.5, fourth 36.
      assertEquals(r.pb.rows.map((row) => row.time), [60, 40, 38.5, 38.5, 36]);
      assertEquals(r.pb.rows.map((row) => row.rank), [1, 2, 3, 3, 5]);
      // Secondary is each player's ranked time that day (leader's was 40).
      assertEquals(r.pb.rows.map((row) => row.secondary), [
        34,
        40,
        38.5,
        38.5,
        36,
      ]);
      assertEquals(r.pb.rows.find((row) => row.you)?.time, 60);
      for (const row of r.pb.rows) {
        assert(!("user" in row));
        // PB rows now carry when the best build was set (their "2h ago" line).
        assert(row.at > 0, "pb row must carry the build's timestamp");
      }

      // A second viewer is served off the cached field: same boards, own slice.
      const asLeader = await standings.handler({ iteration }, authed(leader));
      assert(!("error" in asLeader));
      assertEquals(asLeader.daily.me, {
        rank: 1,
        tied: false,
        time: 40,
        secondary: 40,
        record: "beat",
        percentile: 1,
      });
      assertEquals(asLeader.daily.rows.map((row) => row.you)[0], true);
      assertEquals(asLeader.pb.me?.rank, 2); // 40 sits behind the viewer's 60
    } finally {
      // The iteration cascade removes the seeded runs; users their own.
      await sql`DELETE FROM iteration WHERE id = ${iteration};`;
      for (const user of users) {
        await sql`DELETE FROM user WHERE id = ${user};`;
      }
    }
  },
});

Deno.test({
  name: "standings PB counts a free-play-only day and stays scoped to it",
  ignore: !live,
  fn: async () => {
    // Two days (A < B, by monotonic iteration id) and one player who ONLY free
    // plays day A — no ranked daily run there. This is the regression the PB
    // board is built around: such a day used to render zero rows because the
    // field was drawn from the ranked daily board alone.
    const dayA = await testIteration();
    const dayB = await testIteration();
    const user = await testUser();
    try {
      await seedRun(user, dayA, 20, { daily: false }); // free play only on A
      await seedRun(user, dayA, 15, { daily: false }); // a worse build on A
      await seedRun(user, dayB, 55, { daily: false }); // a better build on B
      await seedRun(user, dayA, 90, { daily: false, voided: true }); // void: ignored

      const a = await standings.handler({ iteration: dayA }, authed(user));
      assert(!("error" in a));

      // Daily board on A: the player has no ranked run, so they're off the
      // board entirely — no rows, no `me`.
      assertEquals(a.daily.players, 0);
      assertEquals(a.daily.me, null);
      assertEquals(a.daily.rows.length, 0);

      // PB board on A: the player IS present, ranked by their best build that
      // day (20, not the voided 90). Their daily secondary is null — they never
      // ran a ranked attempt — and day B's 55 does not leak in.
      assertEquals(a.pb.players, 1);
      assertEquals(a.pb.me?.time, 20);
      assertEquals(a.pb.me?.secondary, null);
      assertEquals(a.pb.rows.length, 1);
      assertEquals(a.pb.rows[0].secondary, null);
      assert(a.pb.rows[0].at > 0, "pb row carries the build's timestamp");

      // PB board on B is its own day: 55, oblivious to day A's 20.
      const b = await standings.handler({ iteration: dayB }, authed(user));
      assert(!("error" in b));
      assertEquals(b.pb.me?.time, 55);
    } finally {
      await sql`DELETE FROM iteration WHERE id = ${dayA};`;
      await sql`DELETE FROM iteration WHERE id = ${dayB};`;
      await sql`DELETE FROM user WHERE id = ${user};`;
    }
  },
});
