import { assertEquals } from "@std/assert";
import { extractUserId } from "../middleware/userid.ts";
import { merge } from "../routes/merge.ts";
import { anonymizeUser } from "./deleteAccount.ts";
import { mergeUsers } from "./merge.ts";
import { sql } from "./query.ts";
import { createOrUpdateUser } from "./user.ts";

// mergeUsers / anonymizeUser against the real (dev) database, since their
// semantics are multi-statement SQL. Rows are seeded directly on the two oldest
// iterations (safely closed days). Skipped without SQL_PASSWORD.
const live = !!Deno.env.get("SQL_PASSWORD");

const testUser = async () => {
  const id = `t-${crypto.randomUUID().slice(0, 16)}`;
  await createOrUpdateUser(id);
  return id;
};

const oldest = () =>
  sql<{ id: number }[]>`SELECT id FROM iteration ORDER BY id ASC LIMIT 2;`
    .then((r) => r.map((i) => i.id));

// One run row; `secs` back-dates created so ordering is deterministic.
const seedRun = (
  user: string,
  iteration: number,
  time: number,
  ranked: boolean,
  daily: boolean,
  secs: number,
) =>
  sql`
    INSERT INTO run (user, iteration, time, data, void, daily, ranked, created)
    VALUES (${user}, ${iteration}, ${time}, '', FALSE, ${daily}, ${ranked},
      NOW() - INTERVAL ${secs} SECOND);`;

const rows = (user: string, iteration: number) =>
  sql<{ time: number; ranked: number; daily: number }[]>`
    SELECT time, ranked, daily FROM run
    WHERE user = ${user} AND iteration = ${iteration}
    ORDER BY time ASC;`.then((r) =>
    r.map((x) => ({
      time: x.time,
      ranked: !!Number(x.ranked),
      daily: !!Number(x.daily),
    }))
  );

// pb_top is keyed by iteration and shared with real data on the dev database:
// snapshot the row and put it back afterwards.
const withPbTop = async (
  iteration: number,
  fn: () => Promise<void>,
) => {
  const [saved] = await sql<Record<string, unknown>[]>`
    SELECT * FROM pb_top WHERE iteration = ${iteration};`;
  try {
    await fn();
  } finally {
    await sql`DELETE FROM pb_top WHERE iteration = ${iteration};`;
    if (saved) {
      await sql`
        INSERT INTO pb_top (iteration, message_id, top_user, top_time, holders,
          announced_at)
        VALUES (${saved.iteration}, ${saved.message_id}, ${saved.top_user},
          ${saved.top_time}, ${saved.holders}, ${saved.announced_at});`;
    }
  }
};

Deno.test({
  name: "merge keeps the primary's ranked attempts on a day both ranked",
  ignore: !live,
  fn: async () => {
    const primary = await testUser();
    const secondary = await testUser();
    try {
      const [both, onlySecondary] = await oldest();
      // Both ranked `both`: the secondary did better there.
      await seedRun(primary, both, 10, true, true, 300);
      await seedRun(primary, both, 11, true, false, 200);
      await seedRun(secondary, both, 50, true, true, 100);
      // Only the secondary ranked `onlySecondary`.
      await seedRun(secondary, onlySecondary, 20, true, true, 100);

      await mergeUsers(primary, secondary);

      assertEquals(await rows(primary, both), [
        { time: 10, ranked: true, daily: true },
        { time: 11, ranked: true, daily: false },
        // Moved over as history, never as a fourth ranked attempt.
        { time: 50, ranked: false, daily: false },
      ]);
      // A day only one side ranked moves over whole.
      assertEquals(await rows(primary, onlySecondary), [
        { time: 20, ranked: true, daily: true },
      ]);
    } finally {
      await sql`DELETE FROM user WHERE id IN (${[primary, secondary]});`;
    }
  },
});

Deno.test({
  name: "merge carries the top-PB holder to the primary",
  ignore: !live,
  fn: async () => {
    const primary = await testUser();
    const secondary = await testUser();
    const [iteration] = await oldest();
    try {
      await withPbTop(iteration, async () => {
        await sql`
          INSERT INTO pb_top (iteration, top_user) VALUES (${iteration}, ${secondary})
            ON DUPLICATE KEY UPDATE top_user = VALUES(top_user);`;

        await mergeUsers(primary, secondary);

        const [top] = await sql<{ top_user: string }[]>`
          SELECT top_user FROM pb_top WHERE iteration = ${iteration};`;
        assertEquals(top.top_user, primary);
      });
    } finally {
      await sql`DELETE FROM user WHERE id IN (${[primary, secondary]});`;
    }
  },
});

Deno.test({
  name: "erasure re-points the top-PB holder",
  ignore: !live,
  fn: async () => {
    const user = await testUser();
    const newId = crypto.randomUUID();
    const [iteration] = await oldest();
    try {
      await withPbTop(iteration, async () => {
        await sql`
          INSERT INTO pb_top (iteration, top_user) VALUES (${iteration}, ${user})
            ON DUPLICATE KEY UPDATE top_user = VALUES(top_user);`;

        await anonymizeUser(user, newId);

        const [top] = await sql<{ top_user: string }[]>`
          SELECT top_user FROM pb_top WHERE iteration = ${iteration};`;
        assertEquals(top.top_user, newId, "the old id must not survive");
      });
    } finally {
      await sql`DELETE FROM user WHERE id IN (${[user, newId]});`;
    }
  },
});

Deno.test({
  name: "merge into a nonexistent primary is a 400, not a 500",
  ignore: !live,
  fn: async () => {
    const user = await testUser();
    try {
      const req = new Request("http://localhost/api/merge", {
        headers: { authorization: user },
      });
      extractUserId(req, {} as never, undefined);
      const res = await merge.handler(
        { other: `t-${crypto.randomUUID().slice(0, 16)}`, primary: "other" },
        req,
      );
      assertEquals(res, { error: "unknown profile", status: 400 });
    } finally {
      await sql`DELETE FROM user WHERE id = ${user};`;
    }
  },
});
