import type { Point } from "../common/types.ts";
import { BinaryHeap } from "./BinaryHeap.ts";
import { offsets } from "./constants.ts";

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

// Grazing tolerance: touching an obstacle boundary (rounding a corner, sliding
// along a wall) must read as clear, so obstacle boxes are tested shrunk by this
// much. Only a genuine interior crossing blocks.
const EPS = 1e-9;

// Liang–Barsky segment/box clip: does the segment (ax,ay)->(bx,by) cross the
// *interior* of the axis-aligned box over a positive length? Touching an edge
// or corner does not count.
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
// `from` to `to` (node (x,y) => centre (x+0.5, y+0.5)); the move is clear iff
// the swept square never enters a blocked cell's interior. Equivalently, the
// centre segment must not cross any blocked cell grown by half the runner on
// every side (`x-0.5 .. x+1.5`). Grazing is allowed, so paths round corners,
// but two diagonally-touching blocks leave a zero-width gap the runner can't
// squeeze through.
export const lineOfSight = (from: Point, to: Point, grid: boolean[][]) => {
  const ax = from.x + 0.5;
  const ay = from.y + 0.5;
  const bx = to.x + 0.5;
  const by = to.y + 0.5;

  // A grown cell reaches 0.5 past itself, so only cells within one cell of the
  // segment's bounding box can matter.
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

// Canonical identity of a set of pieces: sorted geometry + thunder flag. Keys
// PathSolver's result memo and cachedSolver's solvers.
const placementKey = (
  pieces: ReadonlyArray<Readonly<Point & { thunder?: boolean | undefined }>>,
) => pieces.map((b) => `${b.thunder ? "t" : ""}${b.x},${b.y}`).sort().join(";");

// Does this node path cross a 2x2 piece's inflated footprint, i.e. would adding
// the piece invalidate the path? The piece is one rectangle, grown by the
// half-runner and EPS-shrunk like lineOfSight's per-cell boxes, so a path that
// returns false here at most grazes it.
const pathTouchesPiece = (path: ReadonlyArray<Point>, piece: Point) => {
  const xMin = piece.x - 0.5 + EPS;
  const yMin = piece.y - 0.5 + EPS;
  const xMax = piece.x + 2.5 - EPS;
  const yMax = piece.y + 2.5 - EPS;
  for (let i = 1; i < path.length; i++) {
    if (
      segmentCrossesBox(
        path[i - 1].x + 0.5,
        path[i - 1].y + 0.5,
        path[i].x + 0.5,
        path[i].y + 0.5,
        xMin,
        yMin,
        xMax,
        yMax,
      )
    ) return true;
  }
  return false;
};

// Blocked or out of bounds. Unlike this, `lineOfSight` ignores off-grid cells;
// all nodes are on-board, so the two agree where it matters.
const isBlocked = (grid: boolean[][], x: number, y: number) =>
  grid[y]?.[x] !== false;

const diagonals = [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const;

// Is this free cell a convex corner the taut path can bend around? Obstacles
// are inflated by half the runner (see `lineOfSight`), and the taut path only
// bends at the resulting convex corners: a free cell diagonally touching a
// blocked cell whose two shared-edge neighbours are both free. A blocked
// orthogonal neighbour makes a concave notch the runner can't round. A segment
// squeezing through a diagonal gap is rejected later by `lineOfSight`.
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

// THE pathing engine: an exact any-angle shortest-path solver over a visibility
// graph of obstacle corners. Not Theta*: it relaxes against a single ancestor
// and can settle for a slightly longer route. Optimality is test-asserted
// against a brute-force visibility graph over EVERY free cell, using the same
// `lineOfSight` oracle.
//
// Built for repeated solves on the SAME base board (an iteration's fixed
// pieces). The base is precomputed once; each `solve` pays only for what the
// player's pieces change:
//
// - Base-pair visibility is precomputed. Adding blocks never *creates*
//   visibility, so an invisible base pair stays invisible and a visible one
//   only needs a bbox-filtered check against the player pieces.
// - New corner nodes can only appear in the one-cell ring around a player
//   piece; any other cell's neighbourhood is untouched, so it was a corner on
//   the base board already.
// - Both legs share the checkpoint and the graph is undirected, so ONE
//   Dijkstra rooted at the checkpoint settles start and end together.
// - A save stream is the same maze ± one piece each time, so recent results
//   are memoized and a one-piece addition often needs no search (rules and
//   determinism contract: see `solve`).
//
// Any change that can shift equal-length tie-breaking (with thunders, duration
// depends on geometry, not just length) or timing requires a
// scripts/comparePathing.ts audit/retime before it ships.
export class PathSolver {
  private grid: boolean[][];
  private checkpointCell: Point;
  // Node order: 0 = start, 1 = end, 2 = checkpoint cell, then base corners.
  private baseNodes: Point[];
  private baseLOS: Uint8Array;
  // Whether the base board carries a thunder. Gates the reuse shortcut
  // (`oneAddedShortcut`): with a thunder, duration depends on which
  // equal-length path comes back, so only a fresh search is duration-exact.
  private baseHasThunder: boolean;

  // Throws "invalid data" when a base block is out of bounds or overlaps
  // another block or the checkpoint cell.
  constructor(
    baseBlocks: ReadonlyArray<
      Readonly<Point & { thunder?: boolean | undefined }>
    >,
    checkpoint: Point,
    start: Point = { x: 9, y: 19 },
    end: Point = { x: 10, y: 0 },
  ) {
    this.baseHasThunder = baseBlocks.some((b) => b.thunder);
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
    // The checkpoint cell blocks placements but not the runner.
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

  // The empty placement's result (the base board), asked for by every board
  // stage/view: searched once, copied out thereafter.
  private baseResult?: { path: Point[] | undefined };

  // Recent placements' results, keyed by sorted piece coordinates (order is
  // irrelevant, as in the engine) PLUS thunder flags. The flags must be in the
  // key: the reuse shortcut can store a non-cold (equal-length) path for a
  // thunder-free state, and a block->thunder upgrade of the same geometry must
  // not be served it, since with a thunder the geometry is duration-visible.
  // Thunder-carrying states therefore only hit entries searched cold. Re-saves,
  // undo/redo and commit-time revalidation land here, and the resume view
  // returns byte-identical results to the save that produced them. Bounded LRU;
  // entries are never mutated, copies go out.
  private results = new Map<string, { path: Point[] | undefined }>();

  private remember(key: string, path: Point[] | undefined) {
    this.results.set(key, { path });
    // Sized for hover: pointer-move validity probes go through solve() too, and
    // must not evict the save stream states `oneAddedShortcut` keys off.
    if (this.results.size > 128) {
      this.results.delete(this.results.keys().next().value!);
    }
  }

  // Solve one player placement against the precomputed base. Throws "invalid
  // data" on an out-of-bounds or overlapping piece, returns undefined when no
  // route exists, otherwise the shortest start -> checkpoint -> end path.
  //
  // Determinism contract: the DURATION (via pathDuration) always equals what a
  // cold solver produces, so an audit recompute reproduces every persisted
  // time. The GEOMETRY is cold-identical too, except via the thunder-free
  // `oneAddedShortcut`, which may return a different equally-short path
  // (cosmetic: without thunders duration depends on length alone).
  solve(
    pieces: ReadonlyArray<Readonly<Point & { thunder?: boolean | undefined }>>,
  ): Point[] | undefined {
    if (pieces.length === 0) {
      // The grid already is the base board.
      this.baseResult ??= { path: this.search(pieces) };
      return this.baseResult.path?.map((p) => ({ ...p }));
    }

    // A key only exists for a placement that validated, so a hit can skip the
    // overlap checks.
    const key = placementKey(pieces);
    const hit = this.results.get(key);
    if (hit) {
      // Re-insert so a live build's states stay ahead of eviction.
      this.results.delete(key);
      this.results.set(key, hit);
      return hit.path?.map((p) => ({ ...p }));
    }

    const { grid, checkpointCell } = this;

    // The checkpoint cell counts as occupied for overlap, then is freed for the
    // search. The base grid is shared across solves, so `placed` records every
    // cell to restore, even when a piece throws half-placed.
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

      const shortcut = this.oneAddedShortcut(pieces);
      const path = shortcut ? shortcut.path : this.search(pieces);
      this.remember(key, path);
      return path?.map((p) => ({ ...p }));
    } finally {
      for (const { x, y } of placed) grid[y][x] = false;
      grid[checkpointCell.y][checkpointCell.x] = false;
    }
  }

  // The edit-stream shortcut: when this placement is a solved one plus exactly
  // one piece, monotonicity often answers without a search. Blocks only
  // lengthen or sever the route, so an unsolvable predecessor stays unsolvable
  // (thunders or not). A predecessor's optimal path the new piece doesn't touch
  // is still optimal, but a fresh search could return a different equal-length
  // path, and near thunders duration depends on geometry, so that reuse is only
  // duration-exact on a thunder-free board. On real build streams ~27% of
  // placements skip the search. Returns null when no shortcut applies.
  private oneAddedShortcut(
    pieces: ReadonlyArray<Readonly<Point & { thunder?: boolean | undefined }>>,
  ): { path: Point[] | undefined } | null {
    const thunderFree = !this.baseHasThunder &&
      !pieces.some((b) => b.thunder);
    for (let i = 0; i < pieces.length; i++) {
      const key = placementKey(pieces.filter((_, j) => j !== i));
      const prev = key === "" ? this.baseResult : this.results.get(key);
      if (!prev) continue;
      if (!prev.path) return { path: undefined };
      if (thunderFree && !pathTouchesPiece(prev.path, pieces[i])) return prev;
    }
    return null;
  }

  // The augmented-board search. `solve` has already placed and validated the
  // pieces on the grid.
  private search(
    pieces: ReadonlyArray<Readonly<Point>>,
  ): Point[] | undefined {
    const { grid, baseNodes, baseLOS } = this;
    const nBase = baseNodes.length;

    // Live nodes: base nodes not covered by a piece, then corners the pieces
    // created.
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
    // Sorted row-major before joining the node list: Dijkstra breaks
    // equal-length ties by node order, so piece arrival order must not
    // influence which optimal path comes back, or the same maze built in two
    // orders could time differently near thunders.
    const ringCorners: number[] = [];
    for (const { x, y } of pieces) {
      for (let ry = y - 1; ry <= y + 2; ry++) {
        for (let rx = x - 1; rx <= x + 2; rx++) {
          // Ring only; the interior is the piece.
          if (rx > x - 1 && rx < x + 2 && ry > y - 1 && ry < y + 2) continue;
          // Off-board cells read as blocked, so the key below is on-board.
          if (isBlocked(grid, rx, ry)) continue;
          const key = ry * 20 + rx;
          if (seen.has(key)) continue;
          if (!isCornerCell(grid, rx, ry)) continue;
          seen.add(key);
          ringCorners.push(key);
        }
      }
    }
    ringCorners.sort((a, b) => a - b);
    for (const key of ringCorners) {
      nodes.push({ x: key % 20, y: (key - key % 20) / 20 });
      baseIdx.push(-1);
    }

    // A piece's inflated footprint is a single box (see `pathTouchesPiece`).
    const boxes: number[] = [];
    for (const { x, y } of pieces) {
      boxes.push(x - 0.5 + EPS, y - 0.5 + EPS, x + 2.5 - EPS, y + 2.5 - EPS);
    }

    const visible = (i: number, j: number) => {
      const bi = baseIdx[i];
      const bj = baseIdx[j];
      // Piece-created corners have no precomputed answer: ask the oracle.
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

    // Base node order is preserved, so start/end/checkpoint keep their indices.
    const startIdx = baseIdx.indexOf(0);
    const endIdx = baseIdx.indexOf(1);
    const checkpointIdx = baseIdx.indexOf(2);
    // A piece covering start or end means no path (the checkpoint can't be
    // covered: overlap throws).
    if (startIdx < 0 || endIdx < 0 || checkpointIdx < 0) return undefined;

    const n = nodes.length;
    const gScore = new Float64Array(n).fill(Infinity);
    const parent = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    gScore[checkpointIdx] = 0;

    // Lazy-deletion heap: a relaxation pushes a fresh (node, g) snapshot and
    // stale entries are skipped on pop via `closed`, avoiding
    // BinaryHeap.remove's linear scan.
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
        // The cheap relaxation test gates the expensive visibility test.
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

    // The tree is rooted at the checkpoint, so the parent walk from start is
    // start -> checkpoint and the walk from end is checkpoint -> end reversed.
    // Points are copied so callers can't alias the shared base nodes.
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

// One PathSolver per base board, content-addressed and LRU-bounded, so server
// validation, board staging and the client preview share one precompute AND one
// tie-breaking: the same placement gets the same geometry, which keeps
// previewed and persisted times equal on thunder mazes. A constructor throw
// (bad base data) is not cached and propagates.
const solverCache = new Map<string, PathSolver>();
const MAX_CACHED_SOLVERS = 32;

export const cachedSolver = (
  baseBlocks: ReadonlyArray<
    Readonly<Point & { thunder?: boolean | undefined }>
  >,
  checkpoint: Point,
): PathSolver => {
  // Thunder flags are in the key: `baseHasThunder` gates the reuse shortcut, so
  // bases differing only in a flag must not share an instance.
  const key = `${checkpoint.x},${checkpoint.y}|` + placementKey(baseBlocks);
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

// Thunder mechanics, in seconds and cell units.
const THUNDER_RADIUS = 4;
// Seconds of half speed per trigger. A re-trigger RESETS this timer (slows
// never stack), wasting the interrupted slow's tail.
const SLOW_DURATION = 6;
// Minimum seconds between one thunder's triggers.
const TRIGGER_COOLDOWN = 3.2;

export type Slow = {
  time: number;
  thunder: Point;
};

// Where a path is inside a circle, as [start, end] intervals in DISTANCE along
// the path: a thunder's trigger windows. Intervals that meet at a segment joint
// (up to float noise) are merged. A tangent graze is dropped, so "in range" is
// strict, as with lineOfSight's boundaries.
const circleWindows = (
  path: ReadonlyArray<Readonly<Point>>,
  cum: ReadonlyArray<number>,
  cx: number,
  cy: number,
  radius: number,
) => {
  const list: [number, number][] = [];
  for (let i = 1; i < path.length; i++) {
    const segment = cum[i] - cum[i - 1];
    if (segment === 0) continue;
    const dx = path[i].x - path[i - 1].x;
    const dy = path[i].y - path[i - 1].y;
    const fx = path[i - 1].x - cx;
    const fy = path[i - 1].y - cy;
    const a = dx * dx + dy * dy;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - radius * radius;
    const disc = b * b - 4 * a * c;
    if (disc <= 0) continue;
    const sq = disc ** 0.5;
    const u1 = Math.max(0, (-b - sq) / (2 * a));
    const u2 = Math.min(1, (-b + sq) / (2 * a));
    if (u2 <= u1) continue;
    const start = cum[i - 1] + u1 * segment;
    const end = cum[i - 1] + u2 * segment;
    const previous = list[list.length - 1];
    if (previous && start <= previous[1] + 1e-9) {
      previous[1] = Math.max(previous[1], end);
    } else list.push([start, end]);
  }
  return list;
};

// Cumulative distance along the path, node by node (cum[0] = 0).
const pathDistances = (path: ReadonlyArray<Readonly<Point>>) => {
  const cum: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    cum.push(cum[i - 1] + euclideanDistance(path[i - 1], path[i]));
  }
  return cum;
};

// The runner's travel time along `path` and the slows it triggered, rounded to
// the two decimals the game stores and displays. Validation, staging and the
// client preview all consume this.
//
// The walk is exact and continuous: an event-driven computation, not a stepped
// simulation, so duration is a smooth function of the maze and distinct mazes
// never collapse into one quantized time.
//
// Model: the runner moves at SPEED, halved while slowed. A thunder triggers
// when the runner is strictly within THUNDER_RADIUS of its centre (anchor cell
// + 0.5, in the path's node coordinates) and its own TRIGGER_COOLDOWN has
// passed, at the earliest such instant (range entry, or cooldown expiry while
// still inside). Every trigger resets the shared slow to SLOW_DURATION.
// Thunders whose earliest instants coincide exactly all fire together: one
// shared slow, all cooldowns consumed, all recorded.
//
// Range is pure geometry (per thunder, `circleWindows` intervals in distance).
// Only the distance<->time mapping depends on the slow schedule, and between
// events it is linear, so the walk advances event to event in closed form.
export const pathDuration = (
  path: ReadonlyArray<Readonly<Point>> = [],
  thunders: ReadonlyArray<Readonly<Point>> = [],
): [duration: number, slows: Slow[]] => {
  if (path.length < 2) return [0, []];

  const cum = pathDistances(path);
  const total = cum[cum.length - 1];

  const windows = thunders.map((thunder) =>
    circleWindows(path, cum, thunder.x + 0.5, thunder.y + 0.5, THUNDER_RADIUS)
  );

  let t = 0;
  let d = 0;
  let slowEnd = -Infinity;
  const lastFire = thunders.map(() => -Infinity);
  const slows: Slow[] = [];

  // When the runner reaches `target` distance from where it is now: at most two
  // linear pieces, half speed until the slow expires, full after.
  const timeToReach = (target: number) => {
    if (t < slowEnd) {
      const coveredSlowed = d + (slowEnd - t) * (SPEED / 2);
      if (target <= coveredSlowed) return t + (target - d) / (SPEED / 2);
      return slowEnd + (target - coveredSlowed) / SPEED;
    }
    return t + (target - d) / SPEED;
  };

  while (true) {
    // The earliest feasible trigger across all thunders. A trigger in a window
    // fires at max(window entry, cooldown ready) and must land STRICTLY before
    // the runner exits it (firing at the exit is a graze). Windows behind the
    // runner are spent, but one that is merely cooldown-infeasible now is
    // reconsidered later: another thunder's slow can dilate time enough to make
    // it reachable.
    let best = Infinity;
    let firing: number[] = [];
    for (let i = 0; i < thunders.length; i++) {
      for (const [start, end] of windows[i]) {
        if (end <= d) continue;
        const entry = start <= d ? t : timeToReach(start);
        const fire = Math.max(entry, lastFire[i] + TRIGGER_COOLDOWN);
        if (fire >= timeToReach(end)) continue;
        if (fire < best) {
          best = fire;
          firing = [i];
        } else if (fire === best) firing.push(i);
        break;
      }
    }
    if (best === Infinity) break;

    // Advance to the trigger instant, then fire everything due at it.
    if (t < slowEnd) {
      const boundary = Math.min(slowEnd, best);
      d += (boundary - t) * (SPEED / 2);
      t = boundary;
    }
    if (t < best) {
      d += (best - t) * SPEED;
      t = best;
    }
    slowEnd = t + SLOW_DURATION;
    for (const i of firing) {
      lastFire[i] = t;
      slows.push({ time: t, thunder: { x: thunders[i].x, y: thunders[i].y } });
    }
  }

  return [
    Math.round(timeToReach(total) * 100) / 100,
    slows.map(({ time, thunder }) => ({
      time: Math.round(time * 100) / 100,
      thunder,
    })),
  ];
};
