// Leak detection: does this maze have an accidental hole?
//
// A leak is a gap the runner squirts through that the player did not mean to
// leave. Operationally: some single extra block, placed adjacent to the route,
// would raise the time a lot. That block is the patch, its gain is the cost of
// the leak, and the path you get after applying it is the maze the player was
// TRYING to build -- which is the thing worth classifying on, because the
// player thinks of a leaked coil as their coil, not as a new idea.
//
// Probing every legal anchor would be 300+ solves per maze; only cells the
// route actually passes can plug it, so the candidate set is the ring around
// the realised path. Reports the best patch per maze.
//
//   deno run --allow-read --allow-write scratchpad/shapes/probeLeaks.ts <user-prefix> <iteration>
import { cachedSolver, pathDuration } from "../../common/pathing.ts";
import { deserializeRun } from "../../server/util/run.ts";
import type { Point } from "../../common/types.ts";

const DIR = new URL("../", import.meta.url).pathname;
const readJsonl = <T>(n: string): T[] =>
  Deno.readTextFileSync(`${DIR}${n}`).split("\n").filter((l) => l.trim()).map(
    (l) => JSON.parse(l) as T,
  );

if (Deno.args.length < 2) {
  console.error("usage: probeLeaks.ts <user-prefix> <iteration>");
  Deno.exit(1);
}
const userPrefix = Deno.args[0];
const iterationId = Number(Deno.args[1]);

type Iter = {
  id: number;
  bricks: number;
  power: number;
  checkpoint_x: number;
  checkpoint_y: number;
  min: number;
};
const iter = readJsonl<Iter>("iteration.jsonl").find((i) =>
  i.id === iterationId
)!;
const base = readJsonl<
  { iteration: number; x: number; y: number; kind: string }
>(
  "block.jsonl",
).filter((b) => b.iteration === iterationId).map((b) =>
  b.kind === "thunder" ? { x: b.x, y: b.y, thunder: true } : { x: b.x, y: b.y }
);
const checkpoint = { x: iter.checkpoint_x, y: iter.checkpoint_y };
const solver = cachedSolver(base, checkpoint);
const baseThunders = base.filter((b) => b.thunder);

const runs = readJsonl<
  {
    user: string;
    iteration: number;
    created: string;
    time: number;
    void: number;
    data: string;
  }
>("run.jsonl").filter((r) =>
  !r.void && r.data && r.iteration === iterationId &&
  r.user.startsWith(userPrefix)
);

// Distinct mazes only -- a re-run of the same maze has the same leak.
const seen = new Map<
  string,
  { pieces: (Point & { thunder?: boolean })[]; time: number; created: string }
>();
for (const r of runs) {
  const pieces = deserializeRun(r.data);
  const key = pieces.map((p) => `${p.x},${p.y},${p.thunder ? 1 : 0}`).sort()
    .join("|");
  if (!seen.has(key)) {
    seen.set(key, { pieces, time: r.time, created: r.created });
  }
}

const timeOf = (pieces: (Point & { thunder?: boolean })[]) => {
  let path: Point[] | undefined;
  try {
    path = solver.solve(pieces);
  } catch {
    return null;
  }
  if (!path) return null;
  const [d] = pathDuration(path, [
    ...baseThunders,
    ...pieces.filter((b) => b.thunder),
  ]);
  return { duration: d, path };
};

const out: string[] = [];
let probes = 0;
for (const [key, { pieces, time, created }] of seen) {
  const cur = timeOf(pieces);
  if (!cur) continue;

  // Candidate anchors: every cell whose 2x2 footprint could touch the route.
  const cand = new Set<number>();
  for (const p of cur.path) {
    for (let dy = -2; dy <= 1; dy++) {
      for (let dx = -2; dx <= 1; dx++) {
        const x = p.x + dx, y = p.y + dy;
        if (x >= 1 && y >= 1 && x <= 17 && y <= 17) cand.add(y * 20 + x);
      }
    }
  }

  let best = {
    gain: 0,
    x: -1,
    y: -1,
    time: cur.duration,
    path: cur.path,
  };
  for (const k of cand) {
    const x = k % 20, y = (k - x) / 20;
    probes++;
    const t = timeOf([...pieces, { x, y }]);
    if (!t) continue; // patch would make the board unsolvable -- not a leak
    const gain = t.duration - cur.duration;
    if (gain > best.gain) best = { gain, x, y, time: t.duration, path: t.path };
  }

  out.push(JSON.stringify({
    key,
    created,
    time,
    pieces: pieces.map((p) => [p.x, p.y, p.thunder ? 1 : 0]),
    patch: best.gain > 0 ? [best.x, best.y] : null,
    patch_gain: Number(best.gain.toFixed(2)),
    patched_time: Number(best.time.toFixed(2)),
    spare_bricks: iter.bricks - pieces.length,
    // The realised route, and the route the maze WOULD have forced with its
    // best single patch. When a maze is leaky the second is the player's
    // intent, and classifying on intent is what keeps a leaked coil filed
    // under the coil the player was building.
    path: cur.path.map((p) => [p.x, p.y]),
    patched_path: best.path.map((p) => [p.x, p.y]),
  }));
}

Deno.writeTextFileSync(
  `${DIR}shapes/leaks-${userPrefix}-${iterationId}.jsonl`,
  out.join("\n") + "\n",
);
console.log(
  `${out.length} distinct mazes, ${probes} probe solves; budget ${iter.bricks} bricks`,
);
