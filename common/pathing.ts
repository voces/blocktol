import { Point } from "../common/types.ts";
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

const euclideanDistance = (s: Node, e: Node) =>
  Math.abs(s.x - e.x) + Math.abs(s.y - e.y);

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

  const heuristic = (node: Node) =>
    Math.sqrt((endNode.x - node.x) ** 2 + (endNode.y + node.y) ** 2);

  const getNeighbors = (node: Node) => {
    const neighbors: Node[] = [];
    if (node.x > 0 && !grid[node.y][node.x - 1]) {
      neighbors.push(nodes.getOrSet(node.x - 1, node.y));
    }
    if (node.y > 0 && !grid[node.y - 1][node.x]) {
      neighbors.push(nodes.getOrSet(node.x, node.y - 1));
    }
    if (node.x < 19 && !grid[node.y][node.x + 1]) {
      neighbors.push(nodes.getOrSet(node.x + 1, node.y));
    }
    if (node.y < 19 && !grid[node.y + 1][node.x]) {
      neighbors.push(nodes.getOrSet(node.x, node.y + 1));
    }
    return neighbors;
  };

  const startNode = nodes.getOrSet(start.x, start.y);

  startNode.gScore = 0;
  startNode.parent = startNode;

  // Initializing open and closed sets. The open set is initialized
  // with the start node and an initial cost
  const open = new BinaryHeap((node: Node) => node.gScore + heuristic(node));
  open.push(startNode);
  const closed = new Set<Node>();

  // This main loop is the same as A*
  while (open.length) {
    const cur = open.pop();
    if (cur === endNode) return reconstructPath(cur);
    closed.add(cur);
    for (const neighbor of getNeighbors(cur)) {
      if (closed.has(neighbor)) continue;
      // If the length of the path from start to cur and from cur to
      // neighbor is shorter than the shortest currently known distance
      // from start to neighbor, then update node with the new distance
      const newGScore = cur.gScore + euclideanDistance(cur, neighbor);
      if (newGScore < neighbor.gScore) {
        neighbor.gScore = newGScore;
        neighbor.parent = cur;
        open.remove(neighbor);
        open.push(neighbor);
      }
    }
  }
};

export const findPath = (grid: boolean[][], checkpoint: Point) => {
  const checkpointCell = { x: checkpoint.x + 0.5, y: checkpoint.y + 0.5 };
  grid[checkpointCell.y][checkpointCell.x] = false;

  const pathA = _findPath({ x: 9, y: 19 }, checkpointCell, grid);
  if (!pathA) {
    grid[checkpointCell.y][checkpointCell.x] = true;
    return;
  }

  const pathB = _findPath(checkpointCell, { x: 10, y: 0 }, grid);
  if (!pathB) {
    grid[checkpointCell.y][checkpointCell.x] = true;
    return;
  }

  grid[checkpointCell.y][checkpointCell.x] = true;

  return [...pathA, ...pathB.slice(1)];
};

export const pathDuration = (path: Point[], _thunders: Point[]) =>
  parseFloat((path.length * 0.2).toFixed(2));
