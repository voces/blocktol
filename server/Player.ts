import { findPath, pathDuration } from "../common/pathing.ts";
import { Message } from "../common/serverToClientMessage.ts";
import { Point } from "../common/types.ts";
import { game } from "./Game.ts";

type PlayerStatus = "midjoin" | "afk" | "playing";

const HOUSE = 2; // 2**(1000/1000)

const reverseInterpolate = (left: number, right: number, value: number) =>
  (value - left) / (right - left);

// copy and pasted from revo; adapt to what we actually want...
const reverseTween = (data: number[], value: number): number => {
  if (value < data[0]) return 0;
  const length = data.length - 1;
  if (value > data[length]) return 1;

  let left = 0;
  let right = length;
  let middle = Math.floor((left + right) / 2);
  while (left <= right) {
    if (data[middle] < value) left = middle + 1;
    else if (data[middle] > value) right = middle - 1;
    else break;

    middle = Math.floor((left + right) / 2);
  }

  // Exact match, find center for duplicates
  if (value === data[middle]) {
    left = middle;
    while (data[left - 1] === value) left--;
    right = middle;
    while (data[right + 1] === value) right++;
    return (left + right) / 2 / length;
  }

  const leftvalue = data[middle];
  const rightValue = data[middle + 1];
  const relativePercent = reverseInterpolate(leftvalue, rightValue, value);

  return (
    (middle * (1 - relativePercent) + (middle + 1) * relativePercent) /
    length
  );
};

export class Player {
  #websocket: WebSocket;
  plays: number;
  status: PlayerStatus = "midjoin";

  grid: boolean[][] = [];
  checkpoint: Point = { x: 0, y: 0 };
  blocks: (Point & { thunder?: boolean })[] = [];
  bricks = 0;
  power = 0;

  private static map = new WeakMap<WebSocket, Player>();

  constructor(
    websocket: WebSocket,
    readonly id: string,
    readonly username: string,
    readonly rating: number,
    plays: number,
  ) {
    this.#websocket = websocket;
    this.plays = plays;

    websocket.addEventListener("close", () => game.removePlayer(this));

    Player.map.set(websocket, this);
  }

  startRound(
    grid: boolean[][],
    checkpoint: Point,
    bricks: number,
    power: number,
  ) {
    this.grid = grid;
    this.checkpoint = checkpoint;
    this.bricks = bricks;
    this.power = power;
    this.blocks = [];
    this.status = "afk";
  }

  send(message: Message) {
    this.#websocket.send(JSON.stringify(message));
  }

  close(reason: string) {
    console.log(new Date(), "Closing", reason);
    this.#websocket.close();
  }

  run(times: number[], min: number) {
    const path = findPath(this.grid, this.checkpoint) ?? [];
    const duration = pathDuration(path, this.blocks.filter((b) => b.thunder));

    // A player is only ranked if they place a block (i.e., AFKs are ignored)
    if (this.status === "playing") {
      const expectedPercentile = 2 ** (this.rating / 1000) /
        (2 ** (this.rating / 1000) + HOUSE);
      const actualPercentile = times.length === 0
        ? expectedPercentile
        : reverseTween(times, duration);
      this.plays++;
    }

    return [path, duration] as const;
  }

  static from(socket: WebSocket) {
    return Player.map.get(socket);
  }
}
