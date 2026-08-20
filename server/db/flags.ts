import { Point } from "../../common/types.ts";
import { deserializeFlags, serializeFlags } from "../util/flags.ts";
import { sql } from "./query.ts";

// A player's flags (manual split checkpoints) on one board. One row per
// (user, iteration) holding the whole set in a single column — flags are only
// ever read and written as a set, and the client owns the editing, so there's
// nothing to gain from a row per flag.
export const getFlags = (user: string, iteration: number) =>
  sql<{ data: string }[]>`
    SELECT data FROM flag WHERE user = ${user} AND iteration = ${iteration};
  `.then((rows) => rows[0] ? deserializeFlags(rows[0].data) : []);

// Absolute-value upsert of the whole set — idempotent, so it rides `sql`'s
// retry (a lost response re-writes the same set). An empty set deletes the row
// rather than storing an empty string, so "no flags" is one state.
export const setFlags = (
  user: string,
  iteration: number,
  flags: ReadonlyArray<Point>,
) =>
  flags.length === 0
    ? sql`DELETE FROM flag WHERE user = ${user} AND iteration = ${iteration};`
    : sql`
      INSERT INTO flag (user, iteration, data)
      VALUES (${user}, ${iteration}, ${serializeFlags(flags)})
      ON DUPLICATE KEY UPDATE data = VALUES(data);
    `;
