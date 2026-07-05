// One-time audit of the `run` table: recompute every non-void run against its
// iteration and flag any that aren't legal — too many blocks/power, an illegal
// placement, no path, or a stored `time` that doesn't match the maze. This is
// what surfaces the rows corrupted by the cross-iteration write bug (a run whose
// time was computed for a different iteration).
//
// Dry-run by default: prints a report and changes nothing. Pass `--apply` to
// DELETE the illegal runs.
//
// Run locally against an environment (reads the same proxy the app uses):
//   APP_ENV=prod SQL_PASSWORD=... \
//     deno run --allow-net --allow-env=APP_ENV,SQL_PASSWORD scripts/auditRuns.ts
//   ...add --apply to actually delete.
//
// Reusing validateRun means "legal" here is identical to what the server accepts
// on write, so the audit can't drift from the live rules.

import { type ExecResult, sql } from "../server/db/query.ts";
import { deserializeRun } from "../server/util/run.ts";
import {
  type IterationShape,
  validateRun,
} from "../server/util/validateRun.ts";

// Single-precision float round-trip through the DB plus 2-decimal rounding in
// pathDuration means an exact `===` would spuriously fail; real corruption is
// off by whole seconds, so this tolerance separates the two cleanly.
const TIME_EPSILON = 0.005;

const apply = Deno.args.includes("--apply");

type IllegalRun = {
  user: string;
  iteration: number;
  created: string;
  time: number;
  data: string;
  reason: string;
};

const iterationRows = await sql<
  {
    id: number;
    bricks: number;
    power: number;
    checkpoint_x: number;
    checkpoint_y: number;
  }[]
>`SELECT id, bricks, power, checkpoint_x, checkpoint_y FROM iteration;`;

const blockRows = await sql<
  { iteration: number; x: number; y: number; kind: "block" | "thunder" }[]
>`SELECT iteration, x, y, kind FROM block;`;

const iterations = new Map<number, IterationShape>(
  iterationRows.map((i) => [i.id, {
    bricks: i.bricks,
    power: i.power,
    checkpoint: { x: i.checkpoint_x, y: i.checkpoint_y },
    blocks: [],
  }]),
);
for (const b of blockRows) {
  iterations.get(b.iteration)?.blocks.push(
    b.kind === "thunder"
      ? { x: b.x, y: b.y, thunder: true }
      : { x: b.x, y: b.y },
  );
}

// Only scored runs — void rows are in-progress/abandoned placeholders (empty
// data, not counted) and the corruption always landed on a void=FALSE row.
const runRows = await sql<
  {
    user: string;
    iteration: number;
    created: string;
    time: number;
    data: string;
  }[]
>`SELECT user, iteration, created, time, data FROM run WHERE void = FALSE;`;

const illegal: IllegalRun[] = [];

for (const r of runRows) {
  const iteration = iterations.get(r.iteration);
  const flag = (reason: string) => illegal.push({ ...r, reason });

  if (!iteration) {
    flag("missing iteration");
    continue;
  }

  let playerBlocks;
  try {
    playerBlocks = deserializeRun(r.data);
  } catch {
    flag("undeserializable data");
    continue;
  }

  const v = validateRun(iteration, playerBlocks);
  if (!v.ok) {
    flag(v.reason);
    continue;
  }
  if (Math.abs(v.duration - r.time) > TIME_EPSILON) {
    flag(`time mismatch (stored ${r.time}, actual ${v.duration})`);
  }
}

const byReason = new Map<string, number>();
for (const r of illegal) {
  // Collapse the mismatch detail so the summary groups cleanly.
  const key = r.reason.startsWith("time mismatch") ? "time mismatch" : r.reason;
  byReason.set(key, (byReason.get(key) ?? 0) + 1);
}

console.log(`Scored runs examined: ${runRows.length}`);
console.log(`Illegal runs: ${illegal.length}`);
for (const [reason, count] of [...byReason].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${reason}: ${count}`);
}
for (const r of illegal.slice(0, 25)) {
  console.log(
    `  iter ${r.iteration} user ${r.user} @ ${r.created} — ${r.reason}`,
  );
}
if (illegal.length > 25) console.log(`  … and ${illegal.length - 25} more`);

if (!apply) {
  console.log("\nDry run — pass --apply to delete these runs.");
  Deno.exit(0);
}

let deleted = 0;
for (const r of illegal) {
  // Keyed on the run's identifying columns (the table has no id). ABS(time-…)
  // rather than `=` because `time` is a single-precision float; user+iteration+
  // created+data already pins the row, so the tolerance only guards precision.
  const res = await sql<ExecResult>`
    DELETE FROM run
    WHERE user = ${r.user}
      AND iteration = ${r.iteration}
      AND created = ${r.created}
      AND data = ${r.data}
      AND ABS(time - ${r.time}) < ${TIME_EPSILON};`;
  deleted += res.affectedRows;
}
console.log(`\nDeleted ${deleted} run(s).`);
