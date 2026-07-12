// Render an SVG that overlays the OLD path (loaded from a git ref) and the
// NEW path (current working tree) for the same board, so the difference a
// pathing change makes is visible at a glance. New is drawn as a thick solid
// blue line; the old path is drawn dashed red *on top* so it stays visible even
// where the two coincide (the blue shows through the gaps).
//
// Obstacles are coloured by who placed them and whether they slow: preplaced
// blocks green, thunders pink, player-placed pieces outlined amber. Every one of
// them still obstructs the runner and shapes both paths — the colour is only a
// legend. The two times are full simulated run times (thunder slows included),
// so the old one can be cross-checked against the run's stored DB time.
//
// The baseline's sibling modules (BinaryHeap/constants/MMap/types) are kept
// around precisely so an old pathing.ts body can be dropped next to them and
// imported directly; the baseline solves via findPathFromData when it has one
// (pre-PathSolver refs) and PathSolver otherwise.
//
// Board source (pick one):
//   --seed=N        generate a deterministic random board (no DB needed)
//   --demo          a fixed board showing all piece kinds (no DB needed)
//   --search[=N]    scan N seeds (default 400) for the biggest old-vs-new gap
//   --iteration=N   pull a real board from the DB (needs APP_ENV + SQL_PASSWORD)
//   --run=USER      with --iteration, overlay that user's placement. If the user
//                   has several runs it lists them all and shows the one the
//                   pathing change moves most; pin one with --created=<ts prefix>
//   --created=TS    with --run, pick the run whose created timestamp starts TS
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
if (
  !baselineSource.includes("findPathFromData") &&
  !baselineSource.includes("PathSolver")
) {
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
  findPathFromData?: (
    blocks: Point[],
    checkpoint: Point,
  ) => Point[] | undefined;
  PathSolver?: new (
    blocks: Point[],
    checkpoint: Point,
  ) => { solve(pieces: Point[]): Point[] | undefined };
  pathDuration: typeof current.pathDuration;
  newGrid: typeof current.newGrid;
};

let svg = "";
try {
  const baseline = await import(baselinePath) as PathingModule;

  // ---- Obtain a board -----------------------------------------------------

  type Cell = Point & { thunder?: boolean; player?: boolean };
  type Board = {
    label: string;
    checkpoint: Point;
    blocks: Cell[];
    storedTime?: number; // the run's persisted (old-algorithm) time, if any
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
    const blocks = board.blocks.map(({ x, y }) => ({ x, y }));
    let path: Point[] | undefined;
    try {
      path = mod.findPathFromData
        ? mod.findPathFromData(blocks, board.checkpoint)
        : new mod.PathSolver!(blocks, board.checkpoint).solve([]);
    } catch {
      return undefined;
    }
    if (!path) return undefined;
    const thunders = board.blocks.filter((b) => b.thunder);
    return { path, seconds: mod.pathDuration(path, thunders)[0] };
  };

  // The stretches of a path the runner covers while slowed, as sub-polylines.
  // Derived from the current engine's slows: each trigger slows the runner
  // from its instant until six seconds later or the next trigger's reset,
  // whichever comes first, and positions follow the same piecewise-linear
  // motion (SPEED, halved while slowed). Viz-grade: slow times are the
  // two-decimal ones pathDuration reports.
  const SPEED = current.SPEED;
  const slowedSpans = (path: Point[], thunders: Point[]): Point[][] => {
    if (path.length < 2 || !thunders.length) return [];
    const [, slows] = current.pathDuration(path, thunders);
    if (!slows.length) return [];

    // Slowed wall-clock windows: a re-trigger resets, never stacks.
    const windows: [number, number][] = [];
    for (const { time } of slows) {
      const previous = windows[windows.length - 1];
      if (previous && time <= previous[1]) previous[1] = time + 6;
      else windows.push([time, time + 6]);
    }

    const cum = [0];
    for (let i = 1; i < path.length; i++) {
      cum.push(
        cum[i - 1] +
          Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y),
      );
    }
    const total = cum[cum.length - 1];
    const pointAt = (dist: number): Point => {
      let i = 1;
      while (i < cum.length - 1 && cum[i] < dist) i++;
      const p = (dist - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
      return {
        x: path[i - 1].x * (1 - p) + path[i].x * p,
        y: path[i - 1].y * (1 - p) + path[i].y * p,
      };
    };

    const spans: Point[][] = [];
    let t = 0;
    let d = 0;
    for (const [start, end] of windows) {
      d += (start - t) * SPEED;
      const from = Math.min(d, total);
      d += (end - start) * (SPEED / 2);
      t = end;
      const to = Math.min(d, total);
      if (to <= from) continue;
      // The window's endpoints plus every path vertex inside it.
      const span: Point[] = [pointAt(from)];
      for (let i = 1; i < path.length - 1; i++) {
        if (cum[i] > from && cum[i] < to) span.push(path[i]);
      }
      span.push(pointAt(to));
      spans.push(span);
    }
    return spans;
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
    // Preplaced (iteration-fixed) pieces: green blocks + pink thunders.
    const preplaced: Cell[] = iterBlocks.map((b) => ({
      x: b.x,
      y: b.y,
      thunder: b.kind === "thunder",
      player: false,
    }));
    const checkpoint = { x: iter.checkpoint_x, y: iter.checkpoint_y };

    const runUser = arg("run");
    if (!runUser) {
      board = { label: `iteration ${id}`, checkpoint, blocks: preplaced };
    } else {
      const { deserializeRun } = await import("../server/util/run.ts");
      // A user can have several non-void runs on one iteration, and they differ:
      // scripts/comparePathing.ts scores every one, so picking a single "best by
      // time" here would silently show a different run than the diff you were
      // looking at. Evaluate them all, print the roster, and default to the one
      // the pathing change moves most (largest old→new gap) — pin another with
      // --created=<timestamp prefix>.
      const runs = await sql<{ data: string; time: number; created: string }[]>`
        SELECT data, time, created FROM run
        WHERE iteration = ${id} AND user = ${runUser} AND void = FALSE
        ORDER BY created;
      `;
      const createdFilter = arg("created");
      const candidates = runs
        .filter((r) => !createdFilter || r.created.startsWith(createdFilter))
        .map((r) => {
          const board: Board = {
            label: "",
            checkpoint,
            blocks: [
              ...preplaced,
              ...deserializeRun(r.data).map((p) => ({ ...p, player: true })),
            ],
            storedTime: r.time,
          };
          const o = duration(baseline, board);
          const n = duration(current, board);
          return {
            created: r.created,
            stored: r.time,
            board,
            delta: o && n ? o.seconds - n.seconds : 0,
          };
        });
      if (!candidates.length) {
        console.error(
          createdFilter
            ? `No run for '${runUser}' on iteration ${id} matching --created=${createdFilter}.`
            : `No scored run for '${runUser}' on iteration ${id}.`,
        );
        Deno.exit(1);
      }
      const chosen = candidates.reduce((a, c) =>
        Math.abs(c.delta) > Math.abs(a.delta) ? c : a
      );
      if (candidates.length > 1) {
        console.log(`User has ${candidates.length} runs on iteration ${id}:`);
        for (const c of candidates) {
          console.log(
            `  ${c.created}  stored ${c.stored.toFixed(2)}s  Δ ${
              c.delta.toFixed(2)
            }s${c === chosen ? "   ← showing (largest Δ)" : ""}`,
          );
        }
        console.log("  (pass --created=<timestamp prefix> to pick another)\n");
      }
      board = {
        ...chosen.board,
        label: `iteration ${id} · ${runUser} @ ${chosen.created}`,
      };
    }
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
  } else if (arg("demo") !== undefined) {
    // A no-DB board exercising all four piece kinds so the legend/colours can be
    // eyeballed: preplaced vs player, block vs thunder.
    board = {
      label: "demo · all piece types + slow",
      checkpoint: { x: 9.5, y: 3.5 },
      blocks: [
        { x: 4, y: 6 }, // preplaced block
        { x: 15, y: 7 }, // preplaced block
        { x: 7, y: 13, player: true }, // player block
        { x: 13, y: 12, player: true }, // player block
        { x: 6, y: 9, thunder: true }, // preplaced thunder (near the corridor)
        { x: 12, y: 6, thunder: true, player: true }, // player thunder
      ],
    };
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
  // Per-cell owner/kind so obstacles can be coloured: preplaced vs player, and
  // block vs thunder. All of them still obstruct the runner (they shape both
  // paths); the colour only says who placed it and whether it also slows.
  const meta: (Cell | undefined)[][] = Array.from(
    { length: 20 },
    () => Array<Cell | undefined>(20).fill(undefined),
  );
  for (const b of board.blocks) {
    offsets.forEach(([xd, yd]) => {
      grid[b.y + yd][b.x + xd] = true;
      meta[b.y + yd][b.x + xd] = b;
    });
  }

  const cx = board.checkpoint.x + 1; // checkpoint cell centre
  const cy = board.checkpoint.y + 1;

  const polyline = (path: Point[], attrs: string) =>
    `<polyline points="${
      path.map((p) => `${p.x + 0.5},${p.y + 0.5}`).join(" ")
    }" fill="none" ${attrs} stroke-linejoin="round" stroke-linecap="round"/>`;

  const WALL = "#3a3d44";
  const EMPTY = "#c7d2e8";
  const BLOCK = "#8fce9b"; // preplaced block
  const THUNDER = "#e07fc4"; // thunder (also slows)
  const PLAYER = "#f5a623"; // outline on player-placed pieces

  const cells: string[] = [];
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 20; x++) {
      const wall = y === 0 || x === 0 || y === 19 || x === 19;
      let fill = EMPTY;
      let stroke = "#ffffff22";
      let sw = 0.03;
      if (wall) {
        fill = WALL;
      } else if (grid[y][x]) {
        const m = meta[y][x];
        if (m) { // a placed piece (the checkpoint cell has no meta → stays empty)
          fill = m.thunder ? THUNDER : BLOCK;
          if (m.player) stroke = PLAYER, sw = 0.1;
        }
      }
      cells.push(
        `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}" ` +
          `stroke="${stroke}" stroke-width="${sw}" rx="0.12"/>`,
      );
    }
  }

  const identical = old.path.length === neu.path.length &&
    old.path.every((p, i) => p.x === neu.path[i].x && p.y === neu.path[i].y);
  const hasThunder = board.blocks.some((b) => b.thunder);
  const hasPlayer = board.blocks.some((b) => b.player);

  // Where each route runs slowed. Drawn as a translucent halo beneath the path
  // lines so a thunder's effect on either route is visible.
  const thunders = board.blocks.filter((b) => b.thunder);
  const slowSpans = [
    ...slowedSpans(neu.path, thunders),
    ...slowedSpans(old.path, thunders),
  ];
  const hasSlow = slowSpans.length > 0;
  const slowUnderlay = slowSpans
    .map((s) =>
      polyline(s, `stroke="${THUNDER}" stroke-width="0.55" opacity="0.5"`)
    )
    .join("\n  ");

  const legend: string[] = [
    `<text x="0" y="21.05" fill="#e6e6e6" font-size="0.6" font-weight="600">${board.label}</text>`,
    `<rect x="0" y="21.55" width="0.8" height="0.18" fill="#ff5a5a"/>`,
    `<text x="1" y="21.73" fill="#e6e6e6" font-size="0.56">old (${
      gitRef.slice(0, 12)
    }): ${old.seconds.toFixed(2)}s${
      board.storedTime !== undefined
        ? `  ·  stored ${board.storedTime.toFixed(2)}s ${
          Math.abs(board.storedTime - old.seconds) < 0.02 ? "✓" : "✗ differs"
        }`
        : ""
    }</text>`,
    `<rect x="0" y="22.35" width="0.8" height="0.18" fill="#4c8dff"/>`,
    `<text x="1" y="22.53" fill="#e6e6e6" font-size="0.56">current working tree: ${
      neu.seconds.toFixed(2)
    }s</text>`,
    `<text x="0" y="23.35" fill="#8fce9b" font-size="0.56">Runner reaches exit ${
      (old.seconds - neu.seconds).toFixed(2)
    }s sooner${identical ? "  ·  paths identical on this board" : ""}</text>`,
  ];
  // Fill and outline are independent: fill = piece type (block/thunder), amber
  // outline = who placed it (player vs preplaced). Spell out both dimensions so
  // the four combinations (e.g. a player-placed thunder) can't be misread.
  if (hasPlayer || hasThunder) {
    legend.push(
      `<rect x="0" y="24.05" width="0.5" height="0.5" fill="${BLOCK}" rx="0.1"/>`,
      `<text x="0.65" y="24.43" fill="#e6e6e6" font-size="0.5">block</text>`,
    );
    if (hasThunder) {
      legend.push(
        `<rect x="2.8" y="24.05" width="0.5" height="0.5" fill="${THUNDER}" rx="0.1"/>`,
        `<text x="3.45" y="24.43" fill="#e6e6e6" font-size="0.5">thunder (slows)</text>`,
      );
    }
    if (hasSlow) {
      legend.push(
        `<line x1="7.9" y1="24.3" x2="8.5" y2="24.3" stroke="${THUNDER}" stroke-width="0.4" opacity="0.5" stroke-linecap="round"/>`,
        `<text x="8.65" y="24.43" fill="#e6e6e6" font-size="0.5">slowed (½ speed)</text>`,
      );
    }
    if (hasPlayer) {
      legend.push(
        `<rect x="0" y="24.85" width="0.5" height="0.5" fill="${EMPTY}" stroke="${PLAYER}" stroke-width="0.1" rx="0.1"/>`,
        `<text x="0.65" y="25.23" fill="#e6e6e6" font-size="0.5">amber outline = player-placed  ·  no outline = preplaced</text>`,
      );
    }
  }
  const height = hasPlayer ? 25.9 : (hasThunder ? 24.9 : 24);

  svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-0.5 -0.5 21 ${height}" font-family="ui-sans-serif, system-ui, sans-serif">
  <rect x="-0.5" y="-0.5" width="21" height="${height}" fill="#0f1115"/>
  ${cells.join("\n  ")}
  <circle cx="${cx}" cy="${cy}" r="0.42" fill="none" stroke="#f5c518" stroke-width="0.14"/>
  <line x1="${cx - 0.28}" y1="${cy - 0.28}" x2="${cx + 0.28}" y2="${
      cy + 0.28
    }" stroke="#f5c518" stroke-width="0.12"/>
  <line x1="${cx - 0.28}" y1="${cy + 0.28}" x2="${cx + 0.28}" y2="${
      cy - 0.28
    }" stroke="#f5c518" stroke-width="0.12"/>
  ${slowUnderlay}
  ${polyline(neu.path, `stroke="#4c8dff" stroke-width="0.2" opacity="0.95"`)}
  ${
      polyline(
        old.path,
        `stroke="#ff5a5a" stroke-width="0.16" stroke-dasharray="0.4 0.34"`,
      )
    }
  <circle cx="9.5" cy="19.5" r="0.3" fill="#ffffff"/>
  <circle cx="10.5" cy="0.5" r="0.3" fill="#ffffff"/>
  ${legend.join("\n  ")}
</svg>
`;
} finally {
  await Deno.remove(baselinePath).catch(() => {});
}

await Deno.writeTextFile(out, svg);
console.log(`Wrote ${out}`);
