import { offsets } from "../common/constants.ts";
import { findPath, newGrid, pathDuration } from "../common/pathing.ts";
import { Message } from "../common/serverToClientMessage.ts";
import { Point } from "../common/types.ts";
import {
  getDailyIteration,
  getIterationTimes,
  logRuns,
} from "./db/iteration.ts";
import { dailyAttempts } from "./db/user.ts";
import { BUILD_TIME, game } from "./Game.ts";

type PlayerStatus = "midjoin" | "afk" | "playing";

export const TOKEN_MAX = 10;

const K = 32;

const reverseInterpolate = (left: number, right: number, value: number) =>
  (value - left) / (right - left);

const reverseTween = (data: number[], value: number, min: number): number => {
  if (value < data[0]) return reverseInterpolate(min, data[0], value);
  const length = data.length - 1;
  if (value > data[length]) return (length * 2 + 1) / data.length;

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
  rating: number;
  status: PlayerStatus = "midjoin";

  grid: boolean[][] = [];
  checkpoint: Point = { x: 0, y: 0 };
  blocks: (Point & { thunder?: boolean })[] = [];
  bricks = 0;
  power = 0;
  #gameThunders: Point[] = [];
  tokens = 10;
  remainingDailyAttempts: number;
  dailyTimeout: number | undefined;
  #dailyTimes: Promise<number[]> | undefined;
  #dailyMinTime: number | undefined;
  #dailyIteration: number | undefined;

  private static map = new WeakMap<WebSocket, Player>();

  constructor(
    websocket: WebSocket,
    readonly id: string,
    readonly username: string,
    rating: number,
    plays: number,
    remainingDailyAttempts: number,
    readonly daily: { year: number; month: number; date: number },
  ) {
    this.#websocket = websocket;
    this.plays = plays;
    this.rating = rating;
    this.remainingDailyAttempts = remainingDailyAttempts;

    websocket.addEventListener("close", () => game.removePlayer(this));

    Player.map.set(websocket, this);
  }

  startRound(
    grid: boolean[][],
    checkpoint: Point,
    bricks: number,
    power: number,
    thunders: Point[],
  ) {
    this.grid = grid;
    this.checkpoint = checkpoint;
    this.bricks = bricks;
    this.power = power;
    this.blocks = [];
    this.#gameThunders = thunders;
    this.status = "afk";
  }

  send(message: Message) {
    try {
      this.#websocket.send(JSON.stringify(message));
    } catch {
      this.close("error on send");
    }
  }

  close(reason: string) {
    console.log(new Date(), "Closing", reason);
    this.#websocket.close();
    clearInterval(this.dailyTimeout);
  }

  run(times: number[], min: number) {
    const path = findPath(this.grid, this.checkpoint) ?? [];
    const [duration, slows] = pathDuration(
      path,
      [...this.#gameThunders, ...this.blocks.filter((b) => b.thunder)],
    );

    // A player is only ranked if they place a block (i.e., AFKs are ignored)
    if (this.status === "playing") {
      // Maps 415 -> 0.25, 1000 -> 0.5, 2000 -> 0.75, 3000 -> 0.875
      const expectedPercentile = 1 - 0.5 ** (this.rating / 1_000);
      const actualPercentile = times.length === 0
        ? expectedPercentile
        : reverseTween(times, duration, min);
      const change = K / Math.sqrt(this.plays) *
        (actualPercentile - expectedPercentile);

      this.rating += change;
      this.plays++;
    }

    this.send({ kind: "run", path, duration, slows, rating: this.rating });

    return [duration, this.status === "playing"] as const;
  }

  async dailyStep() {
    const attempts = await dailyAttempts(
      this.id,
      this.daily.year,
      this.daily.month,
      this.daily.date,
    );
    this.remainingDailyAttempts = 3 - attempts.length;

    if (this.remainingDailyAttempts === 0) {
      this.send({
        kind: "daily",
        times: attempts,
        score: attempts.reduce((s, a) => s + a ** 2, 0),
      });

      return game.addPlayer(this, true);
    }

    const daily = await getDailyIteration(
      this.daily.year,
      this.daily.month,
      this.daily.date,
    );
    if (!daily) return this.close("missing daily");

    console.log(
      new Date(),
      "performing daily",
      this.daily,
      `(${daily.iteration})`,
      "with",
      this.remainingDailyAttempts,
      "attempts remaining",
    );

    const grid = newGrid();
    grid[daily.checkpoint.y + 0.5][daily.checkpoint.x + 0.5] = true;
    for (const { x, y } of daily.thunders) {
      offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = true);
    }
    for (const { x, y } of daily.blocks) {
      offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = true);
    }

    this.startRound(
      grid,
      daily.checkpoint,
      daily.bricks,
      daily.power,
      daily.thunders,
    );

    this.#dailyMinTime = pathDuration(
      findPath(this.grid, this.checkpoint) ?? [],
      daily.thunders,
    )[0];
    this.#dailyIteration = daily.iteration;

    this.send({
      kind: "start",
      date: new Date(daily.date).getTime(),
      time: BUILD_TIME,
      checkpoint: this.checkpoint,
      thunders: daily.thunders,
      blocks: daily.blocks,
      power: this.power,
      bricks: this.bricks,
      minTime: 0, // Only used S <-> S
      rating: this.rating,
    });

    this.dailyTimeout = setTimeout(
      () => this.#startDailyRunner(),
      BUILD_TIME * 1_000,
    );

    this.#dailyTimes = getIterationTimes(daily.iteration);
  }

  async #startDailyRunner() {
    const times = await this.#dailyTimes;
    const minTime = this.#dailyMinTime;
    const iteration = this.#dailyIteration;
    if (!times || !minTime || iteration === undefined) {
      return this.close("missing times");
    }

    let max = -Infinity;
    const [duration, log] = this.run(times, minTime);

    if (duration > max) max = duration;

    const now = Date.now();
    this.send({
      kind: "log",
      source: "server",
      time: now + duration * 1_000,
      message: `${this.username} lasted ${duration} seconds.`,
    });

    if (log) {
      console.log(new Date(), "Daily time of", duration);
      logRuns([{ player: this.id, rating: this.rating, duration }], iteration);
    }

    this.dailyTimeout = setTimeout(() => this.dailyStep(), duration * 1_000);
  }

  static from(socket: WebSocket) {
    return Player.map.get(socket);
  }
}
