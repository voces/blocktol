// Render an SVG that overlays the OLD path (Theta*, loaded from a git ref) and
// the NEW path (current working tree) for the same board, so the difference the
// pathing change makes is visible at a glance. Old is drawn dashed red, new
// solid blue; where they coincide the blue simply sits on the red.
//
// The baseline's sibling modules (BinaryHeap/constants/MMap/types) are unchanged
// by the pathing work, so the old pathing.ts body is dropped next to them and
// imported directly — only findPathFromData/pathDuration differ.
//
// Board source (pick one):
//   --seed=N        generate a deterministic random board (no DB needed)
//   --search[=N]    scan N seeds (default 400) for the biggest old-vs-new gap
//   --iteration=N   pull a real board from the DB (needs APP_ENV + SQL_PASSWORD)
//   --run=USER      with --iteration, overlay that user's placed blocks too
//
// Options:
//   --ref=<git ref> baseline to compare against (default: merge-base with prod)
//   --out=PATH      output svg path (default: scratchpad/path-diff.svg)
//
// Examples:
//   deno run --allow-read --allow-run --allow-write scripts/comparePathViz.ts --search
//   deno run --allow-read --allow-run --allow-write scripts/comparePathViz.ts --seed=42
//   APP_ENV=prod SQL_PASSWORD=... deno run --allow-read --allow-run --allow-write \
//     --allow-net --allow-env=APP_ENV,SQL_PASSWORD \
//     scripts/comparePathViz.ts --iteration=41

import { offsets } from "../common/constants.ts";
import type { Point } from "../common/types.ts";
import * as current from "../common/pathing.ts";

const arg = (name: string) => {
  const hit = Deno.args.find((a) =>
    a === `--${name}` || a.startsWith(`--${name}=`)
  );
  if (!hit) return undefined;
  return hit.includes("=") ? hit.split("=").slice(1).join("=") : "";
};

const out = arg("out") ??
  new URL("../scratchpad/path-diff.svg", import.meta.url).pathname;

// ---- Load the baseline (old) pathing module from a git ref ----------------

const gitRef = arg("ref") ||
  new TextDecoder().decode(
    (await new Deno.Command("git", {
      args: ["merge-base", "HEAD", "prod"],
    }).output()).stdout,
  ).trim() || "prod";

const baselineSource = new TextDecoder().decode(
  (await new Deno.Command("git", {
    args: ["show", `${gitRef}:common/pathing.ts`],
  }).output()).stdout,
);
if (!baselineSource.includes("findPathFromData")) {
  console.error(`Could not read common/pathing.ts at ref '${gitRef}'.`);
  Deno.exit(1);
}

// Drop it beside its (unchanged) siblings so relative imports resolve, then
// import it. Cleaned up in the finally below.
const baselinePath =
  new URL("../common/_baselinePathing.tmp.ts", import.meta.url)
    .pathname;
await Deno.writeTextFile(baselinePath, baselineSource);

type PathingModule = {
  findPathFromData: (blocks: Point[], checkpoint: Point) => Point[] | undefined;
  pathDuration: typeof current.pathDuration;
  newGrid: typeof current.newGrid;
};

let svg = "";
try {
  const baseline = await import(baselinePath) as PathingModule;

  // ---- Obtain a board -----------------------------------------------------

  type Board = {
    label: string;
    checkpoint: Point;
    blocks: (Point & { thunder?: boolean })[];
  };

  const generateBoard = (seed: number): Board => {
    let s = (seed * 2654435761) >>> 0;
    const rng = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const checkpoint = {
      x: 1.5 + Math.floor(rng() * 17),
      y: 1.5 + Math.floor(rng() * 17),
    };
    const grid = current.newGrid();
    grid[checkpoint.y + 0.5][checkpoint.x + 0.5] = true;
    const blocks: Point[] = [];
    const target = 6 + Math.floor(rng() * 34);
    for (let i = 0; i < target * 4 && blocks.length < target; i++) {
      const x = 2 + Math.floor(rng() * 17);
      const y = 2 + Math.floor(rng() * 17);
      if (offsets.some(([xd, yd]) => grid[y + yd][x + xd])) continue;
      offsets.forEach(([xd, yd]) => (grid[y + yd][x + xd] = true));
      blocks.push({ x, y });
    }
    return { label: `seed ${seed}`, checkpoint, blocks };
  };

  const duration = (mod: PathingModule, board: Board) => {
    const path = mod.findPathFromData(
      board.blocks.map(({ x, y }) => ({ x, y })),
      board.checkpoint,
    );
    if (!path) return undefined;
    const thunders = board.blocks.filter((b) => b.thunder);
    return { path, seconds: mod.pathDuration(path, thunders)[0] };
  };

  let board: Board;

  if (arg("iteration") !== undefined) {
    // Pull a real board from the DB. Imported lazily so the seed/search paths
    // don't require net/env permissions.
    const { sql } = await import("../server/db/query.ts");
    const id = Number(arg("iteration"));
    const [[iter], iterBlocks] = await sql<
      [
        { checkpoint_x: number; checkpoint_y: number }[],
        { x: number; y: number; kind: "block" | "thunder" }[],
      ]
    >`
      SELECT checkpoint_x, checkpoint_y FROM iteration WHERE id = ${id};
      SELECT x, y, kind FROM block WHERE iteration = ${id};
    `;
    if (!iter) {
      console.error(`Iteration ${id} not found.`);
      Deno.exit(1);
    }
    const blocks: (Point & { thunder?: boolean })[] = iterBlocks.map((b) => ({
      x: b.x,
      y: b.y,
      thunder: b.kind === "thunder",
    }));

    const runUser = arg("run");
    if (runUser) {
      const { deserializeRun } = await import("../server/util/run.ts");
      const [run] = await sql<{ data: string }[]>`
        SELECT data FROM run
        WHERE iteration = ${id} AND user = ${runUser} AND void = FALSE
        LIMIT 1;
      `;
      if (run) blocks.push(...deserializeRun(run.data));
    }
    board = {
      label: `iteration ${id}${runUser ? ` · ${runUser}` : ""}`,
      checkpoint: { x: iter.checkpoint_x, y: iter.checkpoint_y },
      blocks,
    };
  } else if (arg("search") !== undefined) {
    const count = Number(arg("search")) || 400;
    let best: { board: Board; gap: number } | undefined;
    for (let seed = 0; seed < count; seed++) {
      const b = generateBoard(seed);
      const o = duration(baseline, b);
      const n = duration(current, b);
      if (!o || !n) continue;
      const gap = o.seconds - n.seconds;
      if (!best || gap > best.gap) best = { board: b, gap };
    }
    if (!best) {
      console.error("No solvable boards found while searching.");
      Deno.exit(1);
    }
    board = best.board;
    console.log(
      `Largest gap over ${count} seeds: ${board.label} (Δ ${
        best.gap.toFixed(2)
      }s)`,
    );
  } else {
    board = generateBoard(Number(arg("seed")) || 42);
  }

  // ---- Compute both paths -------------------------------------------------

  const old = duration(baseline, board);
  const neu = duration(current, board);
  if (!old || !neu) {
    console.error("Board is unsolvable for one of the algorithms.");
    Deno.exit(1);
  }

  // ---- Render -------------------------------------------------------------

  const grid = current.newGrid();
  grid[board.checkpoint.y + 0.5][board.checkpoint.x + 0.5] = true;
  for (const { x, y } of board.blocks) {
    offsets.forEach(([xd, yd]) => (grid[y + yd][x + xd] = true));
  }

  const cx = board.checkpoint.x + 1; // checkpoint cell centre
  const cy = board.checkpoint.y + 1;

  const polyline = (path: Point[], attrs: string) =>
    `<polyline points="${
      path.map((p) => `${p.x + 0.5},${p.y + 0.5}`).join(" ")
    }" fill="none" ${attrs} stroke-linejoin="round" stroke-linecap="round"/>`;

  const cells: string[] = [];
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 20; x++) {
      const wall = y === 0 || x === 0 || y === 19 || x === 19;
      const fill = grid[y][x] ? (wall ? "#3a3d44" : "#8fce9b") : "#c7d2e8";
      cells.push(
        `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}" ` +
          `stroke="#ffffff22" stroke-width="0.03" rx="0.12"/>`,
      );
    }
  }

  svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-0.5 -0.5 21 24" font-family="ui-sans-serif, system-ui, sans-serif">
  <rect x="-0.5" y="-0.5" width="21" height="24" fill="#0f1115"/>
  ${cells.join("\n  ")}
  <circle cx="${cx}" cy="${cy}" r="0.42" fill="none" stroke="#f5c518" stroke-width="0.14"/>
  <line x1="${cx - 0.28}" y1="${cy - 0.28}" x2="${cx + 0.28}" y2="${
      cy + 0.28
    }" stroke="#f5c518" stroke-width="0.12"/>
  <line x1="${cx - 0.28}" y1="${cy + 0.28}" x2="${cx + 0.28}" y2="${
      cy - 0.28
    }" stroke="#f5c518" stroke-width="0.12"/>
  ${
      polyline(
        old.path,
        `stroke="#ff5a5a" stroke-width="0.17" stroke-dasharray="0.45 0.32" opacity="0.95"`,
      )
    }
  ${polyline(neu.path, `stroke="#4c8dff" stroke-width="0.17" opacity="0.95"`)}
  <circle cx="9.5" cy="19.5" r="0.3" fill="#ffffff"/>
  <circle cx="10.5" cy="0.5" r="0.3" fill="#ffffff"/>
  <text x="0" y="21.1" fill="#e6e6e6" font-size="0.62" font-weight="600">${board.label}</text>
  <rect x="0" y="21.6" width="0.8" height="0.18" fill="#ff5a5a"/>
  <text x="1" y="21.78" fill="#e6e6e6" font-size="0.58">Theta* (old): ${
      old.seconds.toFixed(2)
    }s</text>
  <rect x="0" y="22.4" width="0.8" height="0.18" fill="#4c8dff"/>
  <text x="1" y="22.58" fill="#e6e6e6" font-size="0.58">Visibility graph (new): ${
      neu.seconds.toFixed(2)
    }s</text>
  <text x="0" y="23.4" fill="#8fce9b" font-size="0.58">Δ ${
      (old.seconds - neu.seconds).toFixed(2)
    }s faster${
      old.path.length === neu.path.length &&
        old.path.every((p, i) => p.x === neu.path[i].x && p.y === neu.path[i].y)
        ? "  ·  paths identical on this board"
        : ""
    }</text>
</svg>
`;
} finally {
  await Deno.remove(baselinePath).catch(() => {});
}

await Deno.writeTextFile(out, svg);
console.log(`Wrote ${out}`);
