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

// The turn points of a shortest any-angle path. The runner is a 1x1 square (see
// `lineOfSight`, a swept-square test), so in configuration space every obstacle
// is inflated by half the runner on each side and the taut path only ever bends
// around the resulting convex corners. Such a corner shows up as a free cell
// diagonally touching a blocked cell whose two shared-edge neighbours are both
// free (the runner's centre can round it). A blocked orthogonal neighbour makes
// it a concave notch the runner can't round, so those are excluded — and a
// segment that would clip through a diagonal gap is rejected later by
// `lineOfSight`, keeping the "no corner cutting" rule the game already enforces.
const cornerNodes = (grid: boolean[][]): Point[] => {
  const corners: Point[] = [];
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      if (isBlocked(grid, x, y)) continue;
      for (const [dx, dy] of diagonals) {
        if (
          isBlocked(grid, x + dx, y + dy) &&
          !isBlocked(grid, x + dx, y) &&
          !isBlocked(grid, x, y + dy)
        ) {
          corners.push({ x, y });
          break;
        }
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
      if (!lineOfSight(cur, next, grid)) continue;

      const gScore = cur.gScore + euclideanDistance(cur, next);
      if (gScore < next.gScore) {
        next.gScore = gScore;
        next.parent = cur;
        open.remove(next);
        open.push(next);
      }
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
