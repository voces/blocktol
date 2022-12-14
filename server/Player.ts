import { offsets } from "../common/constants.ts";
import { formatPercentile } from "../common/formatPercentile.ts";
import { gridToString } from "../common/gridToString.ts";
import { findPath, newGrid, pathDuration } from "../common/pathing.ts";
import { Message } from "../common/serverToClientMessage.ts";
import { Point } from "../common/types.ts";
import {
  getDailyIteration,
  getDailyIterationId,
  getIteration,
  getIterationCount,
  getIterationTimeCounts,
  getMaxIterationTime,
  logRun,
} from "./db/iteration.ts";
import {
  dailyAttempts,
  dailyAttemptsByIteration,
  markDaily,
  updateRating,
} from "./db/user.ts";
import { percentileFromTimeCounts } from "./util/math.ts";
import { runEvents } from "./util/metrics.ts";

type PlayerStatus = "init" | "afk" | "loading" | "playing";

const BUILD_TIME = 60;

export const TOKEN_MAX = 10;
export const CHAT_TOKEN_MAX = 5;

const K = 64;

type Daily = {
  year: number;
  month: number;
  day: number;
};

export class Player {
  #websocket: WebSocket;
  plays: number;
  rating: number;
  status: PlayerStatus = "init";

  grid: boolean[][] = [];
  checkpoint: Point = { x: 0, y: 0 };
  blocks: (Point & { thunder?: boolean })[] = [];
  bricks = 0;
  power = 0;
  #gameThunders: Point[] = [];
  #remainingDailyAttempts: number;
  #timeout: number | undefined;
  #iteration: number | undefined;
  #iterationMinTime: number | undefined;
  #doingDaily = true;

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
    this.#remainingDailyAttempts = remainingDailyAttempts;

    Player.map.set(websocket, this);

    this.play();
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
    clearInterval(this.#timeout);
  }

  run() {
    const path = findPath(this.grid, this.checkpoint);

    if (!path) {
      console.log(new Date(), "no path?");
      console.log(gridToString(this.grid, undefined, this.checkpoint));
    }

    return [
      path ?? [],
      ...pathDuration(
        path,
        [...this.#gameThunders, ...this.blocks.filter((b) => b.thunder)],
      ),
    ] as const;
  }

  async sendDailyTimes(daily?: Daily) {
    daily = daily ?? this.daily;

    // We don't need to refetch if loaded...
    const iterationPromise = getDailyIteration(
      daily.year,
      daily.month,
      daily.day,
    );

    const [timeCounts, attempts] = await Promise.all([
      iterationPromise.then((iteration) =>
        iteration ? getIterationTimeCounts(iteration.iteration) : null
      ),
      dailyAttempts(this.id, daily.year, daily.month, daily.day),
    ]);

    if (!timeCounts) return this.close("could not get daily time counts");

    this.send({
      kind: "daily",
      attempts: attempts.map((duration) => ({
        duration,
        percentile: percentileFromTimeCounts(timeCounts, duration) ?? 1,
      })),
    });
  }

  async play(iteration?: number) {
    if (this.status === "playing" || this.status === "loading") {
      this.close("attempt to start new round while playing");
    }

    if (this.#doingDaily) {
      iteration = await getDailyIterationId(
        this.daily.year,
        this.daily.month,
        this.daily.day,
      );
    }

    if (iteration === undefined) iteration = this.#iteration;

    if (this.#doingDaily) {
      if (this.status === "afk") {
        this.close("attempt to start new round while doing daily");
      }

      const attempts = await dailyAttempts(
        this.id,
        this.daily.year,
        this.daily.month,
        this.daily.day,
      );
      this.#remainingDailyAttempts = 3 - attempts.length;

      if (this.#remainingDailyAttempts === 0) {
        this.#doingDaily = false;
        this.status = "init";
        return this.sendDailyTimes();
      }
    }

    if (!iteration) iteration = await this.getRandomIteration();

    clearTimeout(this.#timeout);
    this.status = "loading";

    const details = await getIteration(iteration);
    if (!details) return this.close("missing iteration");

    if (this.#doingDaily) {
      console.log(
        new Date(),
        this.logName,
        "playing daily",
        this.daily,
        `(${details.iteration})`,
        "with",
        this.#remainingDailyAttempts,
        "attempts remaining",
      );
    } else console.log(new Date(), this.logName, "playing", details.iteration);

    const grid = newGrid();
    grid[details.checkpoint.y + 0.5][details.checkpoint.x + 0.5] = true;
    for (const { x, y } of details.thunders) {
      offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = true);
    }
    for (const { x, y } of details.blocks) {
      offsets.forEach(([xd, yd]) => grid[y + yd][x + xd] = true);
    }

    this.startRound(
      grid,
      details.checkpoint,
      details.bricks,
      details.power,
      details.thunders,
    );

    this.#iterationMinTime = pathDuration(
      findPath(this.grid, this.checkpoint) ?? [],
      details.thunders,
    )[0];
    this.#iteration = details.iteration;

    this.send({
      kind: "start",
      date: new Date(details.date).getTime(),
      time: BUILD_TIME,
      checkpoint: this.checkpoint,
      thunders: details.thunders,
      blocks: details.blocks,
      power: this.power,
      bricks: this.bricks,
      rating: this.rating,
      attempts: this.#remainingDailyAttempts,
    });

    this.#timeout = setTimeout(() => this.#startRunner(), BUILD_TIME * 1_000);
  }

  async #startRunner() {
    const minTime = this.#iterationMinTime;
    const iteration = this.#iteration;
    if (!minTime || iteration === undefined) {
      return this.close("missing times");
    }

    const [path, duration, slows] = this.run();

    if (this.status === "playing" || this.#doingDaily) {
      runEvents([{ userId: this.id, iteration, duration }]);
      logRun(iteration, this.id, duration, this.status !== "playing");
    }

    if (this.#doingDaily && this.#remainingDailyAttempts === 1) {
      markDaily(this.id, iteration);
    }

    const [timeCounts, max] = await Promise.all([
      getIterationTimeCounts(iteration),
      getMaxIterationTime(iteration),
    ]);
    // Maps 415 -> 0.25, 1000 -> 0.5, 2000 -> 0.75, 3000 -> 0.875
    const expectedPercentile = 1 - 0.5 ** (this.rating / 1_000);
    const percentile = percentileFromTimeCounts(timeCounts, duration) ??
      1;

    this.send({
      kind: "run",
      iteration: this.#iteration!,
      path: path ?? [],
      duration,
      percentile,
      percent: (duration - minTime) / (Math.max(max ?? 0, duration) - minTime),
      slows,
      rating: this.rating,
    });

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

    if (this.#doingDaily && this.#remainingDailyAttempts === 1) {
      console.log(new Date(), this.logName, "daily complete, logging result");

      const attempts = await dailyAttemptsByIteration(this.id, iteration);

      if (timeCounts.length > 0) {
        const best = Math.max(...attempts);
        const actualPercentile = percentileFromTimeCounts(timeCounts, best) ??
          expectedPercentile;
        const change = K / Math.log2(this.plays + 2) *
          (actualPercentile - expectedPercentile);

        this.rating += change;
        this.plays++;
        updateRating(this.id, this.rating);
      }
    }

    this.status = "init";
    this.#timeout = setTimeout(() => this.play(), duration * 1_000);
  }

  #iterationCount = NaN;
  async getRandomIteration() {
    if (isNaN(this.#iterationCount)) {
      this.#iterationCount = await getIterationCount();
    }

    return Math.ceil(Math.random() * this.#iterationCount);
  }

  static from(socket: WebSocket) {
    return Player.map.get(socket);
  }
}
