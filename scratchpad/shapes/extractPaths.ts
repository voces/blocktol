// Recompute every stored run's exact runner path with the real engine, so the
// shape analysis works on the same geometry the server accepted. Reads the
// three jsonl exports, writes one record per run to paths.jsonl.
//
//   deno run --allow-read --allow-write scratchpad/shapes/extractPaths.ts
import { cachedSolver, pathDuration } from "../../common/pathing.ts";
import { deserializeRun } from "../../server/util/run.ts";
import type { Point } from "../../common/types.ts";

const DIR = new URL("../", import.meta.url).pathname;

const readJsonl = <T>(name: string): T[] =>
  Deno.readTextFileSync(`${DIR}${name}`)
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);

type IterationRow = {
  id: number;
  created: string;
  bricks: number;
  power: number;
  checkpoint_x: number;
  checkpoint_y: number;
  min: number;
  rated: number;
};
type BlockRow = { iteration: number; x: number; y: number; kind: string };
type RunRow = {
  user: string;
  iteration: number;
  created: string;
  time: number;
  daily: number;
  void: number;
  ranked: number;
  pinned: number;
  data: string;
  client_id: string | null;
};

const iterations = readJsonl<IterationRow>("iteration.jsonl");
const blocks = readJsonl<BlockRow>("block.jsonl");
const runs = readJsonl<RunRow>("run.jsonl");

const baseByIteration = new Map<number, (Point & { thunder?: boolean })[]>();
for (const b of blocks) {
  const list = baseByIteration.get(b.iteration) ?? [];
  list.push(
    b.kind === "thunder" ? { x: b.x, y: b.y, thunder: true } : {
      x: b.x,
      y: b.y,
    },
  );
  baseByIteration.set(b.iteration, list);
}
const iterById = new Map(iterations.map((i) => [i.id, i]));

const out: string[] = [];
let ok = 0, mismatch = 0, unsolvable = 0, skipped = 0;
const mismatchExamples: string[] = [];

for (const r of runs) {
  if (r.void || !r.data) {
    skipped++;
    continue;
  }
  const iter = iterById.get(r.iteration);
  if (!iter) {
    skipped++;
    continue;
  }
  const base = baseByIteration.get(r.iteration) ?? [];
  const checkpoint = { x: iter.checkpoint_x, y: iter.checkpoint_y };
  const pieces = deserializeRun(r.data);

  let path: Point[] | undefined;
  try {
    path = cachedSolver(base, checkpoint).solve(pieces);
  } catch {
    path = undefined;
  }
  if (!path) {
    unsolvable++;
    continue;
  }
  const [duration, slows] = pathDuration(path, [
    ...base.filter((b) => b.thunder),
    ...pieces.filter((b) => b.thunder),
  ]);
  if (Math.abs(duration - r.time) > 0.011) {
    mismatch++;
    if (mismatchExamples.length < 5) {
      mismatchExamples.push(
        `iter=${r.iteration} stored=${r.time} recomputed=${duration}`,
      );
    }
  } else ok++;

  out.push(JSON.stringify({
    user: r.user,
    iteration: r.iteration,
    created: r.created,
    time: r.time,
    recomputed: duration,
    ranked: r.ranked,
    daily: r.daily,
    // The checkpoint cell in the engine's own node frame, so the analysis
    // shares one coordinate system with the path.
    checkpoint: { x: checkpoint.x + 0.5, y: checkpoint.y + 0.5 },
    bricks: iter.bricks,
    power: iter.power,
    min: iter.min,
    base: base.map((b) => [b.x, b.y, b.thunder ? 1 : 0]),
    pieces: pieces.map((p) => [p.x, p.y, p.thunder ? 1 : 0]),
    path: path.map((p) => [p.x, p.y]),
    slows: slows.map((s) => [s.time, s.thunder.x, s.thunder.y]),
  }));
}

Deno.writeTextFileSync(`${DIR}shapes/paths.jsonl`, out.join("\n") + "\n");
console.log(
  `wrote ${out.length} runs | time matches ${ok} | mismatch ${mismatch} | unsolvable ${unsolvable} | skipped ${skipped}`,
);
for (const m of mismatchExamples) console.log("  mismatch:", m);
