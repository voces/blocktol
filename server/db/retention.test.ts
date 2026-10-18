import { assertEquals } from "@std/assert";
import { drain } from "../util/retention.ts";
import { sql } from "./query.ts";
import { pruneUnusedUsers } from "./retention.ts";

// pruneUnusedUsers against the real (dev) database. It sweeps the whole table,
// exactly as the cron would there. Skipped without SQL_PASSWORD.
const live = !!Deno.env.get("SQL_PASSWORD");

const seedUser = async (name: string | null, ageDays: number) => {
  const id = `t-${crypto.randomUUID().slice(0, 16)}`;
  await sql`
    INSERT INTO user (id, name, created)
    VALUES (${id}, ${name}, NOW() - INTERVAL ${ageDays} DAY);`;
  return id;
};

const exists = (id: string) =>
  sql<{ id: string }[]>`SELECT id FROM user WHERE id = ${id};`
    .then((r) => r.length === 1);

Deno.test({
  name: "pruneUnusedUsers removes only old, empty, unnamed profiles",
  ignore: !live,
  fn: async () => {
    const [{ id: iteration }] = await sql<{ id: number }[]>`
      SELECT id FROM iteration ORDER BY id ASC LIMIT 1;`;
    const empty = await seedUser("abruptfalcon", 40);
    const recent = await seedUser("abruptfalcon", 5);
    const named = await seedUser("Abrupt Falcon", 40);
    const played = await seedUser("abruptfalcon", 40);
    const flagged = await seedUser(null, 40);
    const all = [empty, recent, named, played, flagged];
    try {
      await sql`
        INSERT INTO run (user, iteration, time, data, void)
        VALUES (${played}, ${iteration}, 1, '', TRUE);
        INSERT INTO flag (user, iteration, data)
        VALUES (${flagged}, ${iteration}, '1,1');`;
      await drain(() => pruneUnusedUsers(30, 1000), 1000, 1000);
      assertEquals(await Promise.all(all.map(exists)), [
        false,
        true,
        true,
        true,
        true,
      ]);
    } finally {
      await sql`DELETE FROM user WHERE id IN (${all});`;
    }
  },
});
