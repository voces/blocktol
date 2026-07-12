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

// Canonical identity of a set of placed pieces: sorted, geometry + thunder
// flag. Shared by PathSolver's result memo and cachedSolver's solver keys.
const placementKey = (
  pieces: ReadonlyArray<Readonly<Point & { thunder?: boolean }>>,
) => pieces.map((b) => `${b.thunder ? "t" : ""}${b.x},${b.y}`).sort().join(";");

// Does this cell-node path cross a 2x2 piece's inflated footprint? The exact
// feasibility question for "does adding this piece invalidate the path": the
// piece's four cells form one rectangle, grown by the half-runner and
// EPS-shrunk exactly like lineOfSight's per-cell boxes, so a path this returns
// false for grazes at most the piece's boundary — still legal travel.
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

// THE pathing engine: an exact any-angle shortest-path solver via a
// visibility graph over obstacle corners — deliberately not Theta*, which
// relaxes against a single ancestor and can settle for a slightly longer
// route no post-smoothing recovers. Optimality is test-asserted against a
// brute-force visibility graph over EVERY free cell, sharing the same
// `lineOfSight` oracle.
//
// Built for surfaces that repeatedly solve placements on the SAME base board
// (an iteration's fixed pieces): the base board's structure is precomputed
// once, then each `solve` only pays for what the player's pieces change,
// three ways:
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
// - A build session's save stream is the same maze ± one piece each time, so
//   recent results are memoized and a one-piece addition often needs no
//   search at all (see `solve` for the exact rules and their determinism
//   contract).
//
// Any change that can shift equal-length tie-breaking (and with thunders,
// duration depends on geometry, not just length) or timing itself requires a
// scripts/comparePathing.ts audit/retime before it ships (see that file's
// header).
export class PathSolver {
  private grid: boolean[][];
  private checkpointCell: Point;
  // Node order: 0 = start, 1 = end, 2 = checkpoint cell, then base corners.
  private baseNodes: Point[];
  private baseLOS: Uint8Array;
  // Whether the base board carries a thunder — gates the reuse shortcut in
  // `solve` (see there): with a thunder anywhere, duration depends on which
  // equal-length path comes back, so only a fresh search is duration-exact.
  private baseHasThunder: boolean;

  // Throws "invalid data" when a base block is out of bounds or overlaps
  // another (or the checkpoint cell) — bad data must never path.
  constructor(
    baseBlocks: ReadonlyArray<Readonly<Point & { thunder?: boolean }>>,
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
    // The checkpoint cell blocks placements (it holds the checkpoint) but not
    // the runner: the search sees it free.
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

  // Recent placements' results, keyed by sorted piece coordinates (placement
  // order is irrelevant, matching the engine's own order-independence) PLUS
  // thunder flags. The flags don't move blocks — but they must be in the key:
  // the reuse shortcut can store a not-cold-identical (equal-length) path for
  // a thunder-free state, and a block→thunder upgrade re-asking for the same
  // geometry must NOT be served that path, because with a thunder the
  // geometry becomes duration-visible. Flagged keys mean thunder-carrying
  // states only ever hit entries that were searched cold. This is what makes
  // a build session cheap: a save stream is the same maze ± one piece each
  // time, so re-saves, undo/redo toggles and commit-time revalidation all
  // land here, and daily's resume view returns byte-identical results to the
  // save that produced them. Bounded LRU; entries are never mutated, copies
  // go out.
  private results = new Map<string, { path: Point[] | undefined }>();

  private remember(key: string, path: Point[] | undefined) {
    this.results.set(key, { path });
    // Sized for hover: pointer-move validity probes flow through solve() too
    // (a candidate piece per hovered cell), and they must not evict the save
    // stream's recent states that the one-added shortcut keys off.
    if (this.results.size > 128) {
      this.results.delete(this.results.keys().next().value!);
    }
  }

  // Solve one player placement against the precomputed base: throws "invalid
  // data" on an out-of-bounds/overlapping piece, returns undefined when no
  // route exists, otherwise the exact shortest start -> checkpoint -> end
  // path.
  //
  // Determinism contract: the returned DURATION (via pathDuration) is always
  // exactly what a cold solver would produce for this state, so an audit
  // recompute reproduces every persisted time. The returned GEOMETRY is
  // cold-identical too, except via the thunder-free reuse shortcut below,
  // which may return a different equally-short optimal path — cosmetic there,
  // because without thunders duration is a function of length alone.
  solve(
    pieces: ReadonlyArray<Readonly<Point & { thunder?: boolean }>>,
  ): Point[] | undefined {
    if (pieces.length === 0) {
      // No pieces to place or restore — the grid already IS the base board.
      this.baseResult ??= { path: this.search(pieces) };
      return this.baseResult.path?.map((p) => ({ ...p }));
    }

    // Exact hit: this placement was solved before (a key only exists for a
    // placement that validated, so skipping the overlap checks is sound).
    const key = placementKey(pieces);
    const hit = this.results.get(key);
    if (hit) {
      // Re-insert so a live build's states stay ahead of eviction.
      this.results.delete(key);
      this.results.set(key, hit);
      return hit.path?.map((p) => ({ ...p }));
    }

    const { grid, checkpointCell } = this;

    // Place the pieces: the checkpoint cell counts as occupied for overlap,
    // then is freed for the search. The base grid is shared across solves, so `placed` tracks every
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
  // one piece, monotonicity often answers without a search. Blocks only ever
  // lengthen or sever the route, so an unsolvable predecessor stays unsolvable
  // — always, thunders or not. And a predecessor's optimal path that the new
  // piece doesn't touch is still feasible at its old (optimal) length, so it
  // remains optimal — but a fresh search could return a DIFFERENT equal-length
  // path, and near thunders duration depends on geometry, so that reuse is
  // only duration-exact on a thunder-free board (both gated here). Measured on
  // real build streams: ~27% of placements skip the search entirely, with the
  // no-thunder gate carving that down only on boards that have one.
  // Returns null when no shortcut applies (search normally).
  private oneAddedShortcut(
    pieces: ReadonlyArray<Readonly<Point & { thunder?: boolean }>>,
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
    // Collected then sorted into row-major order before joining the node list:
    // Dijkstra breaks equal-length ties by node/expansion order, so the order
    // pieces arrive in (a save's placement order, a preview's array order) must
    // never influence which optimal path comes back — the result has to be a
    // function of the board's geometry alone, or the same maze built in two
    // orders could time differently near thunders.
    const ringCorners: number[] = [];
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
          ringCorners.push(key);
        }
      }
    }
    ringCorners.sort((a, b) => a - b);
    for (const key of ringCorners) {
      nodes.push({ x: key % 20, y: (key - key % 20) / 20 });
      baseIdx.push(-1);
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
    // overlap throws) leaves the runner nowhere to go: no path.
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
  baseBlocks: ReadonlyArray<Readonly<Point & { thunder?: boolean }>>,
  checkpoint: Point,
): PathSolver => {
  // Thunder flags ride along in the key: the solver's reuse shortcut is gated
  // on the base board carrying a thunder, so two bases that differ only in a
  // flag must not share an instance.
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

// Thunder mechanics, in seconds/units. The retired tick engine expressed these
// as step counts (6*SPEED of slow, 32*SPEED of cooldown at 0.02s a step); the
// wall-clock values are unchanged.
const THUNDER_RADIUS = 4;
// Seconds of half speed per trigger. A re-trigger RESETS this timer — slows
// never stack, so overlapping triggers waste the interrupted slow's tail.
const SLOW_DURATION = 6;
// Minimum seconds between one thunder's triggers, so a runner passing in a
// straight line isn't hit twice by the same thunder.
const TRIGGER_COOLDOWN = 3.2;

export type Slow = {
  time: number;
  thunder: Point;
};

// The runner's travel time along `path`, exactly and continuously — an
// event-driven computation, not a stepped simulation, so duration is a smooth
// function of the maze rather than being quantized to 0.1-distance ticks
// (which displayed genuinely different mazes as the same time whenever their
// optimal lengths fell in one tick bucket).
//
// Model: the runner moves at SPEED, halved while slowed. A thunder triggers
// when the runner is strictly within THUNDER_RADIUS of its centre (the anchor
// cell + 0.5, in the path's raw node coordinates — the frame the tick engine
// used) and its own TRIGGER_COOLDOWN has passed; triggers happen at the
// earliest such instant (range entry, or cooldown expiry while still inside).
// Every trigger resets the shared slow to SLOW_DURATION. Thunders whose
// earliest instants coincide exactly all fire together — one shared slow, all
// cooldowns consumed, all recorded (the tick engine instead swallowed the
// runners-up's triggers entirely).
//
// Where the runner is in range is pure geometry: per thunder, a short list of
// intervals in DISTANCE along the path (circle/segment intersections). Only
// the mapping distance<->time depends on the slow schedule, and between events
// it is linear, so the walk below advances event to event in closed form.
// Times are rounded to the same two decimals the game stores and displays.
export const pathDuration = (
  path: ReadonlyArray<Readonly<Point>> = [],
  thunders: ReadonlyArray<Readonly<Point>> = [],
): [duration: number, slows: Slow[]] => {
  if (path.length < 2) return [0, []];

  const cum: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    cum.push(cum[i - 1] + euclideanDistance(path[i - 1], path[i]));
  }
  const total = cum[cum.length - 1];

  // Per-thunder in-range windows as [start, end] distance intervals, merged
  // where the polyline leaves one segment inside the circle and enters the
  // next (the same crossing point, up to float noise).
  const windows = thunders.map((thunder) => {
    const cx = thunder.x + 0.5;
    const cy = thunder.y + 0.5;
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
      const c = fx * fx + fy * fy - THUNDER_RADIUS * THUNDER_RADIUS;
      const disc = b * b - 4 * a * c;
      // A tangent graze has no interior crossing — "in range" is strict,
      // mirroring lineOfSight's treatment of boundaries.
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
  });

  let t = 0;
  let d = 0;
  let slowEnd = -Infinity;
  const lastFire = thunders.map(() => -Infinity);
  const slows: Slow[] = [];

  // When the runner reaches `target` distance, from the current state. Two
  // linear pieces at most: half speed until the slow expires, full after.
  const timeToReach = (target: number) => {
    if (t < slowEnd) {
      const coveredSlowed = d + (slowEnd - t) * (SPEED / 2);
      if (target <= coveredSlowed) return t + (target - d) / (SPEED / 2);
      return slowEnd + (target - coveredSlowed) / SPEED;
    }
    return t + (target - d) / SPEED;
  };

  while (true) {
    // The earliest feasible trigger across all thunders. A trigger in a
    // window fires at max(window entry, cooldown ready) and must land
    // STRICTLY before the runner exits the window — firing at the exit point
    // itself is a graze, not a hit. Windows behind the runner are spent, but
    // a window that is merely cooldown-infeasible now must be reconsidered
    // later: another thunder's slow can dilate time enough to make it
    // reachable again, so nothing ahead of the runner is ever discarded.
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

    // Advance the runner to the trigger instant, then fire everything due at
    // exactly that instant: one shared slow reset, every cooldown consumed.
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
