// Audit of the `run` table: recompute every non-void run against its iteration
// and flag any that aren't legal: too many blocks/power, an illegal placement,
// no path, or a stored `time` that doesn't match the maze (e.g. a run whose
// time was computed for a different iteration).
//
// Dry-run by default: prints a report. `--apply` DELETEs the illegal runs.
//
// Run locally against an environment (via the same SQL proxy the app uses):
//   APP_ENV=prod SQL_PASSWORD=... \
//     deno run --allow-net --allow-env=APP_ENV,SQL_PASSWORD,SQL_PROXY_URL scripts/auditRuns.ts
//   ...add --apply to actually delete.
//
// It uses validateRun, so "legal" is what the server accepts on write.

import { type ExecResult, sql } from "../server/db/query.ts";
import { deserializeRun } from "../server/util/run.ts";
import {
  type IterationShape,
  validateRun,
} from "../server/util/validateRun.ts";

// The DB stores `time` as a single-precision float and pathDuration rounds to 2
// decimals, so `===` would spuriously fail; real corruption is off by whole
// seconds.
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

// Scored runs only: void rows are in-progress or abandoned placeholders.
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
  // Collapse the mismatch detail so the summary groups.
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
  // Keyed on user+iteration+data+time: the table has no id, and `created` is
  // left out because its ISO string won't compare against the TIMESTAMP column.
  // Rows identical on these four are duplicates, so deleting both is fine.
  // ABS(time-…) rather than `=` because `time` is a single-precision float.
  const res = await sql<ExecResult>`
    DELETE FROM run
    WHERE user = ${r.user}
      AND iteration = ${r.iteration}
      AND data = ${r.data}
      AND ABS(time - ${r.time}) < ${TIME_EPSILON};`;
  deleted += res.affectedRows;
}
console.log(`\nDeleted ${deleted} run(s).`);
