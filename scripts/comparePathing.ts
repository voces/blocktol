// Compare every stored run's persisted time against what the *current* pathing
// code (common/pathing.ts) computes for the same placement. Its purpose is to
// quantify the impact of a pathing change — e.g. switching Theta* for the exact
// any-angle visibility-graph search — before it ships: how many runs shift, by
// how much, and whether any run gets *slower* under the new code. On a
// thunder-free maze that should essentially never happen (a shorter distance is
// a shorter time); WITH thunders it legitimately can, because findPath minimises
// distance, not time — the new shorter path can pass nearer a thunder and eat
// more slow penalty. So only a regression on a maze with NO fixed or player
// thunder is a red flag worth inspecting.
//
// Dry-run by default: it only reports. Pass --apply to write the recomputed
// optimal times back — UPDATE-ing each run's `time` and each iteration's `min`
// to what the current pathing code produces. Runs that no longer validate are
// never touched (that's scripts/auditRuns.ts's job — it deletes them).
//
// Run locally against an environment (same SQL proxy the app uses):
//   APP_ENV=prod SQL_PASSWORD=... \
//     deno run --allow-net --allow-env=APP_ENV,SQL_PASSWORD scripts/comparePathing.ts
//   ...add --apply to write the new times.
//
// Flags:
//   --iteration=N   only examine runs (and the baseline) for iteration N
//   --limit=N       how many example rows to print per section (default 20)
//   --all           print every changed row, not just the largest deltas
//   --apply         write the recomputed times (default is a dry run)
//
// Because it reuses validateRun — the same source of truth the server writes
// through — "the new time" here is exactly what the server would persist today.

import { type ExecResult, raw, sql } from "../server/db/query.ts";
import { deserializeRun } from "../server/util/run.ts";
import {
  type IterationShape,
  validateRun,
} from "../server/util/validateRun.ts";

// Stored `time` is a single-precision float rounded to 2 decimals; anything
// within this is "unchanged", matching scripts/auditRuns.ts.
const TIME_EPSILON = 0.005;

const arg = (name: string) =>
  Deno.args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const onlyIteration = arg("iteration") ? Number(arg("iteration")) : undefined;
const limit = arg("limit") ? Number(arg("limit")) : 20;
const printAll = Deno.args.includes("--all");
const apply = Deno.args.includes("--apply");

if (onlyIteration !== undefined && !Number.isInteger(onlyIteration)) {
  console.error(`--iteration must be an integer, got ${arg("iteration")}`);
  Deno.exit(1);
}

// Safe because onlyIteration is a validated integer; keeps it out of the query
// string entirely otherwise.
const iterationFilter = (column: string) =>
  raw(onlyIteration !== undefined ? `WHERE ${column} = ${onlyIteration}` : "");
const runFilter = onlyIteration !== undefined
  ? raw(`AND iteration = ${onlyIteration}`)
  : raw("");

// ---- Load iterations + their fixed pieces ---------------------------------

const iterationRows = await sql<
  {
    id: number;
    bricks: number;
    power: number;
    checkpoint_x: number;
    checkpoint_y: number;
    min: number;
  }[]
>`
  SELECT id, bricks, power, checkpoint_x, checkpoint_y, min
  FROM iteration ${iterationFilter("id")};
`;

const blockRows = await sql<
  { iteration: number; x: number; y: number; kind: "block" | "thunder" }[]
>`SELECT iteration, x, y, kind FROM block;`;

const iterations = new Map<
  number,
  { shape: IterationShape; storedMin: number }
>(
  iterationRows.map((i) => [i.id, {
    shape: {
      bricks: i.bricks,
      power: i.power,
      checkpoint: { x: i.checkpoint_x, y: i.checkpoint_y },
      blocks: [],
    },
    storedMin: i.min,
  }]),
);
for (const b of blockRows) {
  iterations.get(b.iteration)?.shape.blocks.push(
    b.kind === "thunder"
      ? { x: b.x, y: b.y, thunder: true }
      : { x: b.x, y: b.y },
  );
}

// ---- Compare iteration baselines (`min`) ----------------------------------
// The baseline is the empty-placement time, so validateRun(shape, []) recomputes
// it with the current code exactly as newIteration originally did.

type MinDelta = {
  id: number;
  stored: number;
  recomputed: number;
  delta: number;
};

const minChanged: MinDelta[] = [];
const minBroken: { id: number; reason: string }[] = [];
for (const [id, { shape, storedMin }] of iterations) {
  const v = validateRun(shape, []);
  if (!v.ok) {
    minBroken.push({ id, reason: v.reason });
    continue;
  }
  const delta = v.duration - storedMin;
  if (Math.abs(delta) > TIME_EPSILON) {
    minChanged.push({ id, stored: storedMin, recomputed: v.duration, delta });
  }
}

// ---- Compare stored runs --------------------------------------------------

type Run = {
  user: string;
  iteration: number;
  created: string;
  time: number;
  data: string;
};
type RunDelta = { run: Run; recomputed: number; delta: number; label: string };

const runRows = await sql<Run[]>`
  SELECT user, iteration, created, time, data
  FROM run WHERE void = FALSE ${runFilter};
`;

// Regression = the new path is genuinely LONGER, which for an optimal solver
// should never happen. We can only judge that by path length, and a maze's time
// only tracks its length when there are no thunders (findPath minimises
// distance; slows are added after, so a shorter path can score a longer time by
// passing nearer a thunder). So we length-classify only thunder-free mazes —
// where duration IS the length in time — and bucket thunder mazes on their own:
// still retimed, but not a length-regression signal.
const improved: RunDelta[] = []; // thunder-free, shorter path — expected
const regressed: RunDelta[] = []; // thunder-free, LONGER path — a real red flag
const thunderChanged: RunDelta[] = []; // has thunders — retimed, not length-comparable
const broken: { label: string; reason: string }[] = []; // no longer validates
let unchanged = 0;

for (const run of runRows) {
  const iteration = iterations.get(run.iteration);
  const label = `iter ${run.iteration} · ${run.user} @ ${run.created}`;
  if (!iteration) {
    broken.push({ label, reason: "missing iteration" });
    continue;
  }

  let playerBlocks;
  try {
    playerBlocks = deserializeRun(run.data);
  } catch {
    broken.push({ label, reason: "undeserializable data" });
    continue;
  }

  const v = validateRun(iteration.shape, playerBlocks);
  if (!v.ok) {
    broken.push({ label, reason: v.reason });
    continue;
  }

  const delta = v.duration - run.time;
  const row: RunDelta = { run, recomputed: v.duration, delta, label };
  if (Math.abs(delta) <= TIME_EPSILON) {
    unchanged++;
  } else if (
    iteration.shape.blocks.some((b) => b.thunder) ||
    playerBlocks.some((b) => b.thunder)
  ) {
    thunderChanged.push(row);
  } else if (delta < 0) {
    improved.push(row);
  } else {
    regressed.push(row);
  }
}

// ---- Report ---------------------------------------------------------------

const fmt = (
  stored: number,
  recomputed: number,
  delta: number,
  label: string,
) =>
  `  ${stored.toFixed(2)}s → ${recomputed.toFixed(2)}s ` +
  `(${delta >= 0 ? "+" : ""}${delta.toFixed(2)}s)  ${label}`;

const stats = (deltas: number[]) => {
  if (!deltas.length) return "n/a";
  const abs = deltas.map(Math.abs).sort((a, b) => a - b);
  const mean = abs.reduce((s, x) => s + x, 0) / abs.length;
  return `mean ${mean.toFixed(3)}s · median ${
    abs[abs.length >> 1].toFixed(3)
  }s · max ${abs[abs.length - 1].toFixed(3)}s`;
};

const runSection = (title: string, rows: RunDelta[]) => {
  console.log(`\n${title}: ${rows.length}`);
  const sorted = [...rows].sort((a, b) =>
    Math.abs(b.delta) - Math.abs(a.delta)
  );
  for (const r of (printAll ? sorted : sorted.slice(0, limit))) {
    console.log(fmt(r.run.time, r.recomputed, r.delta, r.label));
  }
  if (!printAll && rows.length > limit) {
    console.log(`  … and ${rows.length - limit} more`);
  }
};

console.log("=== Iteration baselines (min) ===");
console.log(`Iterations examined: ${iterations.size}`);
console.log(
  `  changed: ${minChanged.length} (${stats(minChanged.map((m) => m.delta))})`,
);
console.log(`  no longer solvable: ${minBroken.length}`);
for (
  const m of [...minChanged].sort((a, b) =>
    Math.abs(b.delta) - Math.abs(a.delta)
  ).slice(0, printAll ? undefined : limit)
) console.log(fmt(m.stored, m.recomputed, m.delta, `iter ${m.id}`));
for (const b of minBroken.slice(0, limit)) {
  console.log(`  iter ${b.id} — ${b.reason}`);
}

console.log("\n=== Stored runs ===");
console.log(`Scored runs examined: ${runRows.length}`);
console.log(`  unchanged (±${TIME_EPSILON}s): ${unchanged}`);
console.log(
  `  retimed, thunder-free — shorter path: ${improved.length} (${
    stats(improved.map((r) => r.delta))
  })`,
);
console.log(
  `  retimed, thunder-free — LONGER path: ${regressed.length} (${
    stats(regressed.map((r) => r.delta))
  })`,
);
console.log(
  `  retimed, has thunders (time ≠ length): ${thunderChanged.length} (${
    stats(thunderChanged.map((r) => r.delta))
  })`,
);
console.log(`  no longer valid: ${broken.length}`);

if (improved.length) {
  runSection("Biggest improvements (stored → new)", improved);
}
if (thunderChanged.length) {
  runSection(
    "Retimed (thunder maze — time shift isn't a length signal)",
    thunderChanged,
  );
}
if (regressed.length) {
  runSection("⚠️  Regressions — new path is LONGER (thunder-free)", regressed);
  console.log(
    "\n⚠️  These are thunder-free mazes where the new path is genuinely longer " +
      "than the stored one — an optimal solver should never do this. Inspect " +
      "them before applying.",
  );
}
if (broken.length) {
  console.log(
    `\nRuns that no longer validate (left untouched): ${broken.length}`,
  );
  for (const b of broken.slice(0, limit)) {
    console.log(`  ${b.label} — ${b.reason}`);
  }
  if (broken.length > limit) {
    console.log(`  … and ${broken.length - limit} more`);
  }
}

// ---- Apply ----------------------------------------------------------------

if (!apply) {
  console.log("\nDry run — pass --apply to write these recomputed times.");
  Deno.exit(0);
}

console.log("\nApplying recomputed times…");

let iterationsUpdated = 0;
for (const m of minChanged) {
  const res = await sql<ExecResult>`
    UPDATE iteration SET min = ${m.recomputed} WHERE id = ${m.id};
  `;
  iterationsUpdated += res.affectedRows;
}

let runsUpdated = 0;
// Every changed run is retimed — thunder mazes included; only the length-based
// *classification* excludes them, not the retime.
for (
  const { run, recomputed } of [...improved, ...regressed, ...thunderChanged]
) {
  // The run table has no id, so pin the row on its identifying columns. ABS(time
  // - stored) guards the single-precision float rather than matching it exactly.
  const res = await sql<ExecResult>`
    UPDATE run SET time = ${recomputed}
    WHERE user = ${run.user}
      AND iteration = ${run.iteration}
      AND created = ${run.created}
      AND data = ${run.data}
      AND ABS(time - ${run.time}) < ${TIME_EPSILON};
  `;
  runsUpdated += res.affectedRows;
}

console.log(
  `Updated ${iterationsUpdated} iteration baseline(s) and ${runsUpdated} run(s).`,
);
