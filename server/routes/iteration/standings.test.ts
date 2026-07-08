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
  name: "standings ranks per-user daily bests and slices the viewer's window",
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
      // board, however good — but a free-play run DOES count toward the PB
      // (all-time best), so the viewer's PB secondary is 60, not 34.
      await seedRun(viewer, iteration, 50, { voided: true });
      await seedRun(viewer, iteration, 60, { daily: false });

      const result = await standings.handler({ iteration }, authed(viewer));
      assert(!("error" in result), "expected a standings payload");

      assertEquals(result.iteration, iteration);
      assertEquals(result.day, [2001, 1, 1]);
      assertEquals(result.players, 5);
      assertEquals(result.sort, "daily");
      // Unrated, but its close is long past — the field is frozen, so it
      // reads final with no countdown.
      assertEquals(result.final, true);
      assertEquals(result.closesAt, null);
      assertEquals(result.me, {
        rank: 5,
        tied: false,
        time: 34,
        // PB secondary = the viewer's all-time best, incl. the 60 free-play run.
        secondary: 60,
        record: null,
        percentile: 0,
      });

      // Competition ranking off each player's best: 40, T2 38.5, T2 38.5,
      // 4th 36, 5th 34 — a five-player field shows whole (podium ∪ viewer±1).
      assertEquals(result.rows.map((r) => r.rank), [1, 2, 2, 4, 5]);
      assertEquals(result.rows.map((r) => r.time), [40, 38.5, 38.5, 36, 34]);
      // Daily rows carry each player's all-time PB as the secondary; only the
      // viewer's differs from their daily time (the 60 free-play run).
      assertEquals(result.rows.map((r) => r.secondary), [
        40,
        38.5,
        38.5,
        36,
        60,
      ]);
      assertEquals(
        result.rows.map((r) => r.tied),
        [false, true, true, false, false],
      );
      assertEquals(
        result.rows.map((r) => r.record),
        ["beat", null, null, null, null],
      );
      assertEquals(result.rows.map((r) => r.you), [
        false,
        false,
        false,
        false,
        true,
      ]);
      assertEquals(result.rows.every((r) => r.gapBefore === 0), true);

      for (const row of result.rows) {
        // The id is the bearer credential — a row must never carry it, only
        // the display name and the derived avatar hue.
        assert(!("user" in row), "row must not expose the player's id");
        assert(typeof row.name === "string" && row.name.length > 0);
        assert(Number.isInteger(row.hue) && row.hue >= 0 && row.hue < 360);
        assert(row.at > 0);
      }

      // A second viewer is served off the cached field: same board, own slice.
      const asLeader = await standings.handler({ iteration }, authed(leader));
      assert(!("error" in asLeader));
      assertEquals(asLeader.me, {
        rank: 1,
        tied: false,
        time: 40,
        secondary: 40,
        record: "beat",
        percentile: 1,
      });
      assertEquals(asLeader.rows.map((r) => r.you)[0], true);

      // The PB sort re-ranks the SAME day's players by their best build as of
      // this day. The viewer's 60 free-play run (on this iteration) is their
      // PB, so they jump to #1 (day best was only 5th); each row's secondary is
      // that day's time. Same five players, same count — just re-sorted.
      const pb = await standings.handler(
        { iteration, sort: "pb" },
        authed(viewer),
      );
      assert(!("error" in pb), "expected a pb standings payload");
      assertEquals(pb.sort, "pb");
      assertEquals(pb.players, 5);
      assertEquals(pb.closesAt, null); // all-time never locks
      assertEquals(pb.me, {
        rank: 1,
        tied: false,
        time: 60,
        secondary: 34,
        record: "beat",
        percentile: 1,
      });
      // PB order: viewer 60, leader 40, {tiedA,tiedB} 38.5, fourth 36.
      assertEquals(pb.rows.map((r) => r.time), [60, 40, 38.5, 38.5, 36]);
      assertEquals(pb.rows.map((r) => r.rank), [1, 2, 3, 3, 5]);
      // Secondary is each player's time that day (leader's day best was 40).
      assertEquals(pb.rows.map((r) => r.secondary), [34, 40, 38.5, 38.5, 36]);
      assertEquals(pb.rows.find((r) => r.you)?.time, 60);
      for (const row of pb.rows) assert(!("user" in row));
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
  name: "standings PB is scoped to the viewed day — no future leak",
  ignore: !live,
  fn: async () => {
    // Two days (early < late, by monotonic iteration id) and one player.
    const early = await testIteration();
    const late = await testIteration();
    const user = await testUser();
    try {
      await seedRun(user, early, 20); // early day's daily run
      await seedRun(user, late, 30); // late day's daily run (so they're on it)
      // A better build made on the LATER day — it must NOT count toward the
      // early day's PB.
      await seedRun(user, late, 60, { daily: false });

      const e = await standings.handler(
        { iteration: early, sort: "pb" },
        authed(user),
      );
      assert(!("error" in e));
      // As of the early day, the player's PB is 20 — the 30/60 came later.
      assertEquals(e.me?.time, 20);

      const l = await standings.handler(
        { iteration: late, sort: "pb" },
        authed(user),
      );
      assert(!("error" in l));
      // As of the late day, everything counts: PB is the 60 free-play build.
      assertEquals(l.me?.time, 60);
    } finally {
      await sql`DELETE FROM iteration WHERE id = ${early};`;
      await sql`DELETE FROM iteration WHERE id = ${late};`;
      await sql`DELETE FROM user WHERE id = ${user};`;
    }
  },
});
