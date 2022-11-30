import { offsets } from "../common/constants.ts";
import { formatPercentile } from "../common/formatPercentile.ts";
import { gridToString } from "../common/gridToString.ts";
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
import { reverseTween } from "./util/math.ts";
import { runEvents } from "./util/metrics.ts";

type PlayerStatus = "midjoin" | "afk" | "playing";

export const TOKEN_MAX = 10;
export const CHAT_TOKEN_MAX = 5;

const K = 32;

type Daily = {
  year: number;
  month: number;
  day: number;
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
  tokens = TOKEN_MAX;
  chatTokens = CHAT_TOKEN_MAX;
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
    readonly daily: Daily,
  ) {
    this.#websocket = websocket;
    this.plays = plays;
    this.rating = rating;
    this.remainingDailyAttempts = remainingDailyAttempts;

    websocket.addEventListener("close", () => game.removePlayer(this));

    Player.map.set(websocket, this);
  }

  get logName() {
    return `'${this.id.slice(0, 8)}...${this.id.slice(-8)}'`;
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

  sendRunLog(username: string, duration: number, percentile: number | null) {
    this.send({
      kind: "log",
      source: "server",
      time: Date.now() + duration * 1_000,
      message: `\\c${username}\\c lasted ${duration} seconds${
        typeof percentile === "number"
          ? ` (p${formatPercentile(percentile)})`
          : ""
      }.`,
    });
  }

  close(reason: string) {
    console.log(new Date(), "Closing", reason);
    this.#websocket.close();
    clearInterval(this.dailyTimeout);
  }

  run(times: number[], min: number) {
    const path = findPath(this.grid, this.checkpoint);

    if (!path) {
      console.log(new Date(), "no path?");
      console.log(gridToString(this.grid, undefined, this.checkpoint));
    }

    const [duration, slows] = pathDuration(
      path,
      [...this.#gameThunders, ...this.blocks.filter((b) => b.thunder)],
    );

    // Maps 415 -> 0.25, 1000 -> 0.5, 2000 -> 0.75, 3000 -> 0.875
    const expectedPercentile = 1 - 0.5 ** (this.rating / 1_000);
    const actualPercentile = times.length === 0
      ? expectedPercentile
      : reverseTween(times, duration, min < duration ? min : duration);
    // A player is only ranked if they place a block (i.e., AFKs are ignored)
    if (this.status === "playing" && times.length > 0) {
      const change = K / Math.log2(this.plays + 2) *
        (actualPercentile - expectedPercentile);

      this.rating += change;
      this.plays++;
    }
    const percentile = times.length === 0 ? null : actualPercentile;

    this.send({
      kind: "run",
      path: path ?? [],
      duration,
      percentile,
      slows,
      rating: this.rating,
    });

    return [duration, percentile, this.status === "playing"] as const;
  }

  async sendDailyTimes(daily?: Daily) {
    daily = daily ?? this.daily;
    const loaded = daily.year === this.daily.year &&
      daily.month === this.daily.month &&
      daily.day === this.daily.day;

    // We don't need to refetch if loaded...
    const iterationPromise = getDailyIteration(
      daily.year,
      daily.month,
      daily.day,
    );

    const [iteration, times, attempts] = await Promise.all([
      iterationPromise,

      (this.#dailyTimes &&
          (!daily ||
            loaded))
        ? this.#dailyTimes
        : (async () => {
          const iteration = await iterationPromise;
          if (!iteration) return;
          return getIterationTimes(iteration.iteration);
        })(),

      dailyAttempts(this.id, daily.year, daily.month, daily.day),
    ]);

    if (!iteration) return this.close(`missing daily ${JSON.stringify(daily)}`);
    if (!times) return this.close("could not get daily times");

    const grid = newGrid();
    grid[iteration.checkpoint.y + 0.5][iteration.checkpoint.x + 0.5] = true;
    for (const { x, y } of iteration.thunders) {
      offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = true);
    }
    for (const { x, y } of iteration.blocks) {
      offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = true);
    }

    const minTime = pathDuration(
      findPath(grid, iteration.checkpoint) ?? [],
      iteration.thunders,
    )[0];

    this.send({
      kind: "log",
      source: "server",
      time: Date.now(),
      message:
        `Blocktol \\localDate(${daily.year}, ${daily.month}, ${daily.day})\n${
          attempts.map((duration) =>
            `${duration}s (p${
              formatPercentile(reverseTween(times, duration, minTime))
            })`
          ).join("\n")
        }`,
    });
  }

  async dailyStep() {
    const attempts = await dailyAttempts(
      this.id,
      this.daily.year,
      this.daily.month,
      this.daily.day,
    );
    this.remainingDailyAttempts = 3 - attempts.length;

    if (this.remainingDailyAttempts === 0) return game.addPlayer(this, true);

    const daily = await getDailyIteration(
      this.daily.year,
      this.daily.month,
      this.daily.day,
    );
    if (!daily) return this.close("missing daily");

    console.log(
      new Date(),
      this.logName,
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
    const [duration, percentile, log] = this.run(times, minTime);

    if (duration > max) max = duration;

    const now = Date.now();
    this.send({
      kind: "log",
      source: "server",
      time: now + duration * 1_000,
      message: `\\c${this.username}\\c lasted ${duration} seconds${
        typeof percentile === "number"
          ? ` (p${formatPercentile(percentile)})`
          : ""
      }.`,
    });

    if (log) {
      runEvents([{
        userId: this.id,
        iteration,
        duration,
        percentile: percentile ?? 1,
      }]);

      logRuns([{ player: this.id, rating: this.rating, duration }], iteration);
    }

    this.dailyTimeout = setTimeout(() => this.dailyStep(), duration * 1_000);
  }

  static from(socket: WebSocket) {
    return Player.map.get(socket);
  }
}
