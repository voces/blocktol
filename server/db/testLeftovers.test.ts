import { test } from "node:test";
import { live } from "./liveTests.ts";
import { sql } from "./query.ts";

// Removes what a crashed integration test left on the dev database: `t-` users
// (only tests mint that prefix; their runs, notifications and push rows
// cascade) and pre-2000 iterations (only standings.test.ts inserts those). The
// hour's grace keeps it off fixtures a concurrent CI run is still using.
test("sweep leftovers from crashed integration tests", {
  skip: !live,
}, async () => {
  await sql`
    DELETE FROM user
    WHERE id LIKE 't-%' AND created < NOW() - INTERVAL 1 HOUR;`;
  await sql`
    DELETE FROM iteration
    WHERE created < '2000-01-01'
      AND NOT EXISTS (
        SELECT 1 FROM run
        WHERE run.iteration = iteration.id
          AND run.created > NOW() - INTERVAL 1 HOUR
      );`;
});
