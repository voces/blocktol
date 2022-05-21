import type { Point } from "../common/types.ts";
import { BinaryHeap } from "./BinaryHeap.ts";
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

const lineOfSight = (from: Node, to: Node, grid: boolean[][]) => {
  if (from === to) return true;

  const tan = (to.x - from.x) / (to.y - from.y);
  const absTan = Math.abs(tan);

  const yStep = from.y <= to.y ? 1 : -1;
  const yRise = Math.abs(from.y - to.y);

  const lBound = Math.min(to.x, from.x);
  const rBound = Math.max(to.x, from.x);

  for (let yd = 0; yd <= yRise; yd++) {
    const y = from.y + yd * yStep;
    const xCenter = from.x + (yd * yStep * tan);
    const xLeft = Math.floor(Math.max(xCenter - absTan, lBound));
    const xRight = Math.ceil(Math.min(xCenter + absTan, rBound));
    for (let x = xLeft; x <= xRight; x++) {
      if (grid[y]?.[x] !== false) return false;
    }
  }

  return true;
};

const euclideanDistance = (s: Point, e: Point) =>
  ((e.x - s.x) ** 2 + (e.y - s.y) ** 2) ** .5;

const updateNode = (
  current: Node,
  neighbor: Node,
  open: BinaryHeap<Node>,
  grid: boolean[][],
) => {
  // This part of the algorithm is the main difference between A* and Theta*
  if (lineOfSight(current.parent!, neighbor, grid)) {
    // If there is line-of-sight between parent(s) and neighbor
    // then ignore s and use the path from parent(s) to neighbor
    const newGScore = current.parent!.gScore +
      euclideanDistance(current.parent!, neighbor);
    if (newGScore < neighbor.gScore) {
      neighbor.gScore = newGScore;
      neighbor.parent = current.parent;
      open.remove(neighbor);
      open.push(neighbor);
    }
  } else {
    // If the length of the path from start to s and from s to
    // neighbor is shorter than the shortest currently known distance
    // from start to neighbor, then update node with the new distance
    const newGScore = current.gScore + euclideanDistance(current, neighbor);
    if (newGScore < neighbor.gScore) {
      neighbor.gScore = newGScore;
      neighbor.parent = current;
      open.remove(neighbor);
      open.push(neighbor);
    }
  }
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

const _findPath = (start: Point, end: Point, grid: boolean[][]) => {
  const nodes = new MMap<[x: number, y: number], Node>((
    x: number,
    y: number,
  ) => ({
    x,
    y,
    gScore: Infinity,
    parent: undefined,
  }));

  const endNode = nodes.getOrSet(end.x, end.y);

  const distanceToEnd = (node: Node) => euclideanDistance(node, endNode);

  const getNeighbors = (node: Node) => {
    const neighbors: Node[] = [];
    if (node.x > 0 && !grid[node.y][node.x - 1]) {
      neighbors.push(nodes.getOrSet(node.x - 1, node.y));
    }
    if (node.y > 0 && !grid[node.y - 1][node.x]) {
      neighbors.push(nodes.getOrSet(node.x, node.y - 1));
    }
    if (node.x < grid[0].length - 1 && !grid[node.y][node.x + 1]) {
      neighbors.push(nodes.getOrSet(node.x + 1, node.y));
    }
    if (node.y < grid.length - 1 && !grid[node.y + 1][node.x]) {
      neighbors.push(nodes.getOrSet(node.x, node.y + 1));
    }
    return neighbors;
  };

  const startNode = nodes.getOrSet(start.x, start.y);

  lineOfSight(startNode, endNode, grid);

  startNode.gScore = 0;
  startNode.parent = startNode;

  // Initializing open and closed sets. The open set is initialized
  // with the start node and an initial cost
  const open = new BinaryHeap((node: Node) =>
    node.gScore + distanceToEnd(node)
  );
  open.push(startNode);
  const closed = new Set<Node>();

  // This main loop is the same as A*
  while (open.length) {
    const cur = open.pop();
    if (cur === endNode) return reconstructPath(cur);
    closed.add(cur);
    for (const neighbor of getNeighbors(cur)) {
      if (closed.has(neighbor)) continue;
      updateNode(cur, neighbor, open, grid);
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

export const SPEED = 5;

type Slow = {
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

  console.log(steps, slows, thunderUsage);

  return [
    Math.round(steps * 10 / SPEED) / 100,
    slows.map(({ time, thunder }) => ({
      time: Math.round(time * 10 / SPEED) / 100,
      thunder,
    })),
  ];
};
