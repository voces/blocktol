import type { Point } from "../common/types.ts";
import { BinaryHeap } from "./BinaryHeap.ts";
import { offsets } from "./constants.ts";
import { MMap } from "./MMap.ts";

export const newGrid = () => {
  const grid = Array.from(Array(20), () => Array<boolean>(20).fill(false));
  for (let i = 0; i < 9; i++) {
    grid[0][i] = true;
    grid[0][19 - i] = true;
    grid[19][i] = true;
    grid[19][19 - i] = true;

    grid[i + 1][0] = true;
    grid[18 - i][0] = true;
    grid[i + 1][19] = true;
    grid[18 - i][19] = true;
  }
  return grid;
};

type Node = {
  x: number;
  y: number;
  gScore: number;
  parent: Node | undefined;
};

// Grazing tolerance: rounding a corner or sliding along a wall touches an
// obstacle boundary and must read as clear, so obstacle rectangles are tested
// shrunk by this much. Only a genuine interior crossing then blocks.
const EPS = 1e-9;

// Liang–Barsky segment/box clip. Returns whether the segment (ax,ay)->(bx,by)
// crosses the *interior* of the axis-aligned box with positive length — i.e. it
// truly passes through, not merely touching an edge or corner.
const segmentCrossesBox = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  xMin: number,
  yMin: number,
  xMax: number,
  yMax: number,
) => {
  const dx = bx - ax;
  const dy = by - ay;
  const p = [-dx, dx, -dy, dy];
  const q = [ax - xMin, xMax - ax, ay - yMin, yMax - ay];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      // Parallel to this pair of edges: outside the slab means no crossing.
      if (q[i] < 0) return false;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  return t1 - t0 > EPS;
};

// Exact swept-square visibility for the 1x1 runner. Its centre travels from
// `from` to `to` (cell node (x,y) => centre (x+0.5, y+0.5)); the move is clear
// iff the swept square never enters a blocked cell's interior. In configuration
// space that is: the centre segment must not cross the interior of any blocked
// cell grown by half the runner on every side (`x-0.5 .. x+1.5`). Grazing a
// boundary is allowed, which both lets the path round corners and — since two
// diagonally-touching blocks leave only a zero-width gap — forbids squeezing the
// unit runner between them.
export const lineOfSight = (from: Point, to: Point, grid: boolean[][]) => {
  const ax = from.x + 0.5;
  const ay = from.y + 0.5;
  const bx = to.x + 0.5;
  const by = to.y + 0.5;

  // A cell's grown rectangle reaches 0.5 past the cell, so a cell can only
  // matter if it lies within one of the segment's cell-space bounds.
  const xLo = Math.floor(Math.min(from.x, to.x)) - 1;
  const xHi = Math.ceil(Math.max(from.x, to.x)) + 1;
  const yLo = Math.floor(Math.min(from.y, to.y)) - 1;
  const yHi = Math.ceil(Math.max(from.y, to.y)) + 1;

  for (let y = yLo; y <= yHi; y++) {
    for (let x = xLo; x <= xHi; x++) {
      if (grid[y]?.[x] !== true) continue;
      if (
        segmentCrossesBox(
          ax,
          ay,
          bx,
          by,
          x - 0.5 + EPS,
          y - 0.5 + EPS,
          x + 1.5 - EPS,
          y + 1.5 - EPS,
        )
      ) return false;
    }
  }

  return true;
};

const euclideanDistance = (s: Point, e: Point) =>
  ((e.x - s.x) ** 2 + (e.y - s.y) ** 2) ** .5;

// Blocked (or out of bounds). Deliberately the exact negation of the walkable
// test inside `lineOfSight` (`grid[y]?.[x] !== false`) so corner detection and
// segment visibility can never disagree about what a cell is.
const isBlocked = (grid: boolean[][], x: number, y: number) =>
  grid[y]?.[x] !== false;

const diagonals = [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const;

// Is this free cell a convex corner the taut path can bend around? The runner
// is a 1x1 square (see `lineOfSight`, a swept-square test), so in
// configuration space every obstacle is inflated by half the runner on each
// side and the taut path only ever bends around the resulting convex corners.
// Such a corner shows up as a free cell diagonally touching a blocked cell
// whose two shared-edge neighbours are both free (the runner's centre can
// round it). A blocked orthogonal neighbour makes it a concave notch the
// runner can't round, so those are excluded — and a segment that would clip
// through a diagonal gap is rejected later by `lineOfSight`, keeping the "no
// corner cutting" rule the game already enforces.
const isCornerCell = (grid: boolean[][], x: number, y: number) => {
  for (const [dx, dy] of diagonals) {
    if (
      isBlocked(grid, x + dx, y + dy) &&
      !isBlocked(grid, x + dx, y) &&
      !isBlocked(grid, x, y + dy)
    ) return true;
  }
  return false;
};

// The turn points of a shortest any-angle path: every free convex-corner cell.
const cornerNodes = (grid: boolean[][]): Point[] => {
  const corners: Point[] = [];
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      if (!isBlocked(grid, x, y) && isCornerCell(grid, x, y)) {
        corners.push({ x, y });
      }
    }
  }
  return corners;
};

const reconstructPath = (s: Node) => {
  const path: Point[] = [];
  let cur: Node | undefined = s;
  while (cur) {
    path.push({ x: cur.x, y: cur.y });
    if (cur === cur.parent) break;
    cur = cur.parent;
  }
  return path.reverse();
};

// Exact any-angle shortest path via a visibility graph. The candidate turn
// points are start, end and every obstacle corner (`cornerNodes`); an edge joins
// two of them when the runner can travel straight between them (`lineOfSight`),
// weighted by Euclidean distance. Because a shortest taut path only ever bends
// at those corners, Dijkstra over this graph returns a provably optimal path —
// unlike Theta*, which relaxes against a single ancestor and can settle for a
// slightly longer route that no amount of post-smoothing recovers.
const _findPath = (start: Point, end: Point, grid: boolean[][]) => {
  const byCoord = new MMap<[x: number, y: number], Node>();
  const nodes: Node[] = [];
  const addNode = (x: number, y: number) => {
    let node = byCoord.get(x, y);
    if (!node) {
      node = { x, y, gScore: Infinity, parent: undefined };
      byCoord.set(node, x, y);
      nodes.push(node);
    }
    return node;
  };

  const startNode = addNode(start.x, start.y);
  const endNode = addNode(end.x, end.y);
  for (const { x, y } of cornerNodes(grid)) addNode(x, y);

  startNode.gScore = 0;

  const open = new BinaryHeap((node: Node) => node.gScore);
  open.push(startNode);
  const closed = new Set<Node>();

  while (open.length) {
    const cur = open.pop();
    if (cur === endNode) return reconstructPath(cur);
    if (closed.has(cur)) continue;
    closed.add(cur);

    for (const next of nodes) {
      if (next === cur || closed.has(next)) continue;

      // Distance is two float ops; `lineOfSight` is a grid sweep. Testing the
      // relaxation first skips the sweep whenever `next` already has a route
      // at least this good — the surviving relaxations are the same ones in
      // the same order, so the resulting path is bit-identical, just cheaper.
      const gScore = cur.gScore + euclideanDistance(cur, next);
      if (gScore >= next.gScore) continue;
      if (!lineOfSight(cur, next, grid)) continue;

      next.gScore = gScore;
      next.parent = cur;
      open.remove(next);
      open.push(next);
    }
  }
};

export const findPath = (
  grid: boolean[][],
  checkpoint: Point,
  start = { x: 9, y: 19 },
  end = { x: 10, y: 0 },
) => {
  const checkpointCell = { x: checkpoint.x + 0.5, y: checkpoint.y + 0.5 };
  // The checkpoint lives on a fractional grid row that its owner allocates when
  // the iteration loads (see `findPathFromData` / `rebuildGrid`). Before that
  // data arrives the board still holds the off-board sentinel checkpoint, so a
  // hover can call in here targeting a row the grid never created — treat that
  // as "no path" rather than writing into an undefined row and throwing.
  if (!grid[checkpointCell.y]) return;
  grid[checkpointCell.y][checkpointCell.x] = false;

  const pathA = _findPath(start, checkpointCell, grid);
  if (!pathA) {
    grid[checkpointCell.y][checkpointCell.x] = true;
    return;
  }

  const pathB = _findPath(checkpointCell, end, grid);
  if (!pathB) {
    grid[checkpointCell.y][checkpointCell.x] = true;
    return;
  }

  grid[checkpointCell.y][checkpointCell.x] = true;

  return [...pathA, ...pathB.slice(1)];
};

export const findPathFromData = (blocks: Point[], checkpoint: Point) => {
  const grid = newGrid();
  grid[checkpoint.y + 0.5][checkpoint.x + 0.5] = true;
  for (const { x, y } of blocks) {
    if (
      offsets.some(([xd, yd]) => {
        if (grid[y + yd][x + xd]) return true;
        grid[y + yd][x + xd] = true;
        return false;
      })
    ) throw new Error("invalid data");
  }

  return findPath(grid, checkpoint);
};

// A reusable exact solver for surfaces that repeatedly solve placements on the
// SAME base board (an iteration's fixed pieces): precompute the base board's
// structure once, then each `solve` only pays for what the player's pieces
// change. It returns exactly the shortest paths `findPathFromData` would
// (parity is test-asserted, and both reuse the `lineOfSight` oracle verbatim);
// it just gets there cheaper, three ways:
//
// - Base-pair visibility is precomputed. Adding blocks never *creates*
//   visibility, so a base node pair invisible on the base board stays
//   invisible, and a visible one only needs "does the segment cross a player
//   piece" — a few bbox-filtered box clips instead of a grid sweep.
// - New corner nodes can only appear in the one-cell ring around a player
//   piece: any other cell's blocked diagonal, own cell and both orthogonal
//   neighbours are untouched by the pieces, so if it's a corner now it already
//   was one on the base board.
// - Both legs share the checkpoint and the graph is undirected, so ONE
//   Dijkstra rooted at the checkpoint settles start and end together instead
//   of two independent searches rebuilding the same graph.
//
// Equal-length shortest paths can tie-break differently from `findPath`'s
// search order, and with thunders duration depends on geometry, not just
// length — so adopting this on a surface that persists times requires a
// scripts/comparePathing.ts audit/retime (see that file's header). Measured on
// every stored prod run: identical lengths throughout, ~3x faster on final
// mazes and ~4-5x on live build streams.
export class PathSolver {
  private grid: boolean[][];
  private checkpointCell: Point;
  // Node order: 0 = start, 1 = end, 2 = checkpoint cell, then base corners.
  private baseNodes: Point[];
  private baseLOS: Uint8Array;

  // Mirrors findPathFromData's construction: throws "invalid data" when a
  // base block is out of bounds or overlaps (including the checkpoint cell).
  constructor(
    baseBlocks: ReadonlyArray<Readonly<Point>>,
    checkpoint: Point,
    start: Point = { x: 9, y: 19 },
    end: Point = { x: 10, y: 0 },
  ) {
    const grid = newGrid();
    const checkpointCell = { x: checkpoint.x + 0.5, y: checkpoint.y + 0.5 };
    grid[checkpointCell.y][checkpointCell.x] = true;
    for (const { x, y } of baseBlocks) {
      if (
        offsets.some(([xd, yd]) => {
          if (grid[y + yd][x + xd]) return true;
          grid[y + yd][x + xd] = true;
          return false;
        })
      ) throw new Error("invalid data");
    }
    // The search sees the checkpoint cell free, exactly like findPath, which
    // unblocks it for the duration of its two searches.
    grid[checkpointCell.y][checkpointCell.x] = false;

    this.grid = grid;
    this.checkpointCell = checkpointCell;
    this.baseNodes = [start, end, checkpointCell];
    // All nodes are on-board (x, y < 20), so y*20+x is a collision-free key.
    const seen = new Set(this.baseNodes.map((p) => p.y * 20 + p.x));
    for (const corner of cornerNodes(grid)) {
      const key = corner.y * 20 + corner.x;
      if (seen.has(key)) continue;
      seen.add(key);
      this.baseNodes.push(corner);
    }

    const n = this.baseNodes.length;
    this.baseLOS = new Uint8Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (lineOfSight(this.baseNodes[i], this.baseNodes[j], grid)) {
          this.baseLOS[i * n + j] = this.baseLOS[j * n + i] = 1;
        }
      }
    }
  }

  // The empty placement's result — the base board itself — asked for by every
  // board stage/view, so it's searched once and copied out thereafter.
  private baseResult?: { path: Point[] | undefined };

  // Solve one player placement against the precomputed base. Same contract as
  // findPathFromData: throws "invalid data" on an out-of-bounds/overlapping
  // piece, returns undefined when no route exists, otherwise the exact
  // shortest start -> checkpoint -> end path.
  solve(pieces: ReadonlyArray<Readonly<Point>>): Point[] | undefined {
    if (pieces.length === 0) {
      // No pieces to place or restore — the grid already IS the base board.
      this.baseResult ??= { path: this.search(pieces) };
      return this.baseResult.path?.map((p) => ({ ...p }));
    }

    const { grid, checkpointCell } = this;

    // Place the pieces with findPathFromData's exact overlap semantics: the
    // checkpoint cell counts as occupied for overlap, then is freed for the
    // search. The base grid is shared across solves, so `placed` tracks every
    // cell to restore — exactly, even when a piece throws half-placed.
    grid[checkpointCell.y][checkpointCell.x] = true;
    const placed: Point[] = [];
    try {
      for (const { x, y } of pieces) {
        if (
          offsets.some(([xd, yd]) => {
            if (grid[y + yd][x + xd]) return true;
            grid[y + yd][x + xd] = true;
            placed.push({ x: x + xd, y: y + yd });
            return false;
          })
        ) throw new Error("invalid data");
      }
      grid[checkpointCell.y][checkpointCell.x] = false;
      return this.search(pieces);
    } finally {
      for (const { x, y } of placed) grid[y][x] = false;
      grid[checkpointCell.y][checkpointCell.x] = false;
    }
  }

  // The augmented-board search. Assumes `solve` already placed the pieces on
  // the grid and validated them.
  private search(
    pieces: ReadonlyArray<Readonly<Point>>,
  ): Point[] | undefined {
    const { grid, baseNodes, baseLOS } = this;
    const nBase = baseNodes.length;

    // Live nodes: base nodes not covered by a piece, then any corners the
    // pieces created (only possible in the one-cell ring around a piece).
    const nodes: Point[] = [];
    const baseIdx: number[] = [];
    const seen = new Set<number>();
    for (let i = 0; i < nBase; i++) {
      const p = baseNodes[i];
      if (grid[p.y][p.x]) continue;
      seen.add(p.y * 20 + p.x);
      nodes.push(p);
      baseIdx.push(i);
    }
    for (const { x, y } of pieces) {
      for (let ry = y - 1; ry <= y + 2; ry++) {
        for (let rx = x - 1; rx <= x + 2; rx++) {
          // Ring only — the interior is the piece itself.
          if (rx > x - 1 && rx < x + 2 && ry > y - 1 && ry < y + 2) continue;
          // Off-board ring cells read as blocked and fall out here, so the
          // y*20+x key below only ever sees on-board coordinates.
          if (isBlocked(grid, rx, ry)) continue;
          const key = ry * 20 + rx;
          if (seen.has(key)) continue;
          if (!isCornerCell(grid, rx, ry)) continue;
          seen.add(key);
          nodes.push({ x: rx, y: ry });
          baseIdx.push(-1);
        }
      }
    }

    // A piece's four cells form one 2x2 rectangle (see `offsets`), so its
    // half-runner-inflated footprint is a single box, EPS-shrunk exactly like
    // lineOfSight's per-cell boxes.
    const boxes: number[] = [];
    for (const { x, y } of pieces) {
      boxes.push(x - 0.5 + EPS, y - 0.5 + EPS, x + 2.5 - EPS, y + 2.5 - EPS);
    }

    const visible = (i: number, j: number) => {
      const bi = baseIdx[i];
      const bj = baseIdx[j];
      // A pair involving a piece-created corner has no precomputed answer;
      // fall back to the oracle on the augmented grid.
      if (bi < 0 || bj < 0) return lineOfSight(nodes[i], nodes[j], grid);
      if (!baseLOS[bi * nBase + bj]) return false;
      const ax = nodes[i].x + 0.5;
      const ay = nodes[i].y + 0.5;
      const bx = nodes[j].x + 0.5;
      const by = nodes[j].y + 0.5;
      for (let b = 0; b < boxes.length; b += 4) {
        const xMin = boxes[b];
        const yMin = boxes[b + 1];
        const xMax = boxes[b + 2];
        const yMax = boxes[b + 3];
        if (
          (ax < xMin && bx < xMin) || (ax > xMax && bx > xMax) ||
          (ay < yMin && by < yMin) || (ay > yMax && by > yMax)
        ) continue;
        if (segmentCrossesBox(ax, ay, bx, by, xMin, yMin, xMax, yMax)) {
          return false;
        }
      }
      return true;
    };

    // Base node order is preserved, so start/end/checkpoint — when alive —
    // are still findable by their base index.
    const startIdx = baseIdx.indexOf(0);
    const endIdx = baseIdx.indexOf(1);
    const checkpointIdx = baseIdx.indexOf(2);
    // A piece covering start or end (the checkpoint cell can't be covered —
    // overlap throws) leaves the runner nowhere to go: no path, like
    // findPath's searches failing to escape a blocked endpoint.
    if (startIdx < 0 || endIdx < 0 || checkpointIdx < 0) return undefined;

    const n = nodes.length;
    const gScore = new Float64Array(n).fill(Infinity);
    const parent = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    gScore[checkpointIdx] = 0;

    // Lazy-deletion heap: a relaxation pushes a fresh (node, g) snapshot and
    // stale entries are skipped on pop via `closed`, instead of paying
    // BinaryHeap.remove's linear scan. Snapshots keep heap keys immutable.
    const open = new BinaryHeap((e: { node: number; g: number }) => e.g);
    open.push({ node: checkpointIdx, g: 0 });
    let settled = 0;

    while (open.length) {
      const { node: cur, g } = open.pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (cur === startIdx || cur === endIdx) {
        settled++;
        if (settled === 2) break;
      }
      const cx = nodes[cur].x;
      const cy = nodes[cur].y;
      for (let j = 0; j < n; j++) {
        if (j === cur || closed[j]) continue;
        // Same ordering as _findPath: the cheap relaxation test gates the
        // expensive visibility test.
        const score = g +
          ((nodes[j].x - cx) ** 2 + (nodes[j].y - cy) ** 2) ** 0.5;
        if (score >= gScore[j]) continue;
        if (!visible(cur, j)) continue;
        gScore[j] = score;
        parent[j] = cur;
        open.push({ node: j, g: score });
      }
    }

    if (!closed[startIdx] || !closed[endIdx]) return undefined;

    // The tree is rooted at the checkpoint, so the parent walk from start IS
    // start -> checkpoint, and the walk from end is checkpoint -> end
    // reversed. Fresh points so callers can't alias the shared base nodes.
    const path: Point[] = [];
    for (let i = startIdx; i !== -1; i = parent[i]) {
      path.push({ x: nodes[i].x, y: nodes[i].y });
    }
    const tail: Point[] = [];
    for (let i = endIdx; parent[i] !== -1; i = parent[i]) {
      tail.push({ x: nodes[i].x, y: nodes[i].y });
    }
    for (let i = tail.length - 1; i >= 0; i--) path.push(tail[i]);
    return path;
  }
}

// One PathSolver per base board, content-addressed and LRU-bounded, so every
// surface that solves against the same iteration — server validation, board
// staging, the client's live preview — shares a single precompute AND a single
// tie-breaking: two surfaces asking about the same placement get the same
// geometry, which is what keeps previewed and persisted times equal on thunder
// mazes. Keyed by geometry only (a thunder is a block that also slows; the
// flag doesn't move it). A constructor throw (bad base data) is never cached
// and propagates to the caller.
const solverCache = new Map<string, PathSolver>();
const MAX_CACHED_SOLVERS = 32;

export const cachedSolver = (
  baseBlocks: ReadonlyArray<Readonly<Point>>,
  checkpoint: Point,
): PathSolver => {
  const key = `${checkpoint.x},${checkpoint.y}|` +
    baseBlocks.map((b) => `${b.x},${b.y}`).sort().join(";");
  const cached = solverCache.get(key);
  if (cached) {
    // Re-insert so hot boards (today's daily) stay ahead of eviction.
    solverCache.delete(key);
    solverCache.set(key, cached);
    return cached;
  }
  const solver = new PathSolver(baseBlocks, checkpoint);
  solverCache.set(key, solver);
  if (solverCache.size > MAX_CACHED_SOLVERS) {
    solverCache.delete(solverCache.keys().next().value!);
  }
  return solver;
};

export const SPEED = 5;

export type Slow = {
  time: number;
  thunder: Point;
};

export const pathDuration = (
  path: ReadonlyArray<Readonly<Point>> = [],
  thunders: ReadonlyArray<Readonly<Point>> = [],
): [duration: number, slows: Slow[]] => {
  if (path.length < 2) return [0, []];

  let distance = 0;
  let consumedDistance = 0;
  let index = 0;
  let distanceToNext = euclideanDistance(path[index], path[index + 1]);
  const thunderUsage = Array<number>(thunders.length).fill(-Infinity);
  const runner = { ...path[0] };
  let slowed = 0;
  const slows: Slow[] = [];
  let steps = 0;

  while (index < path.length - 1) {
    steps++;

    let slowedThisStep = false;
    for (let i = 0; i < thunders.length; i++) {
      if (
        euclideanDistance(runner, {
            x: thunders[i].x + 0.5,
            y: thunders[i].y + 0.5,
          }) > 4 ||
        // Timed so that runner passing by in
        // a straight line won't trigger twice
        thunderUsage[i] + 32 * SPEED >= steps
      ) {
        continue;
      }
      thunderUsage[i] = steps;

      if (!slowedThisStep) {
        slowedThisStep = true;
        slowed = 6 * SPEED;
        slows.push(
          { time: steps, thunder: { x: thunders[i].x, y: thunders[i].y } },
        );
      }
    }

    distance += slowed < 1e-8 ? 0.1 : 0.05;
    slowed -= 0.1;
    while (
      (distance - consumedDistance) + 1e-8 >= distanceToNext &&
      index < path.length
    ) {
      index++;
      consumedDistance += distanceToNext;
      if (index < path.length - 1) {
        distanceToNext = euclideanDistance(path[index], path[index + 1]);
      }
    }

    if (index < path.length - 1) {
      const p = (distance - consumedDistance) / distanceToNext;
      runner.x = path[index].x * (1 - p) + path[index + 1].x * p;
      runner.y = path[index].y * (1 - p) + path[index + 1].y * p;
    }
  }

  return [
    Math.round(steps * 10 / SPEED) / 100,
    slows.map(({ time, thunder }) => ({
      time: Math.round(time * 10 / SPEED) / 100,
      thunder,
    })),
  ];
};
