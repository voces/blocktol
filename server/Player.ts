import { offsets } from "../common/constants.ts";
import { gridToString } from "../common/gridToString.ts";
import { findPath, newGrid, pathDuration } from "../common/pathing.ts";
import { Message } from "../common/serverToClientMessage.ts";
import { Point } from "../common/types.ts";
import {
  getDailyIteration,
  getDailyIterationId,
  getIteration,
  getIterationCount,
  getIterationOtherBest,
  getIterationTimeCounts,
  getMaxIterationTime,
  logRun,
} from "./db/iteration.ts";
import {
  dailyAttempts,
  dailyAttemptsByIteration,
  getOwnBest,
  listDailies,
  markDaily,
  updateRating,
} from "./db/user.ts";
import { percentileFromTimeCounts } from "./util/math.ts";
import { runEvents } from "./util/metrics.ts";

type PlayerStatus = "init" | "afk" | "loading" | "playing";

export const TOKEN_MAX = 10;
export const CHAT_TOKEN_MAX = 5;

const ONE_SECOND = 1_000;
const ONE_MINUTE = ONE_SECOND * 60;

const BUILD_TIME = 60;
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
  username: string;
  daily: Daily;

  grid: boolean[][] = [];
  checkpoint: Point = { x: 0, y: 0 };
  blocks: (Point & { thunder?: boolean; player?: boolean })[] = [];
  bricks = 0;
  power = 0;
  #thunders: Point[] = [];
  #remainingDailyAttempts: number;
  #timeout: number | undefined;
  #deleteTimeout: number | undefined;
  #iteration: number | undefined;
  #iterationMinTime: number | undefined;
  #doingDaily = true;
  #startTime: number | undefined;
  #iterationCreatedAt: string | undefined;
  #ownBest: number | null = null;

  static map = new Map<WebSocket, Player>();

  constructor(
    websocket: WebSocket,
    readonly id: string,
    username: string,
    rating: number,
    plays: number,
    remainingDailyAttempts: number,
    daily: Daily,
  ) {
    this.#websocket = websocket;
    this.username = username;
    this.daily = daily;
    this.plays = plays;
    this.rating = rating;
    this.#remainingDailyAttempts = remainingDailyAttempts;

    Player.map.set(websocket, this);

    this.play();
  }

  get #logName() {
    return `'${this.id.slice(0, 8)}...${this.id.slice(-8)}'`;
  }

  get doingDaily() {
    return this.#doingDaily;
  }

  send(message: Message) {
    try {
      this.#websocket.send(JSON.stringify(message));
    } catch {
      if (this.#deleteTimeout === undefined) this.close("error on send");
    }
  }

  close(reason: string) {
    console.log(new Date(), this.#logName, "Closing", reason);
    this.#websocket.close();

    // Allow abandoning games if not doing daily OR they're less than 2 seconds in
    if (
      this.#remainingDailyAttempts === 0 ||
      (Date.now() - (this.#startTime ?? Infinity)) < 2_000
    ) {
      this.#deleteTimeout = setTimeout(
        () => Player.map.delete(this.#websocket),
        ONE_SECOND,
      );
    } else {
      this.#deleteTimeout = setTimeout(
        () => Player.map.delete(this.#websocket),
        ONE_MINUTE,
      );
    }
  }

  cancel() {
    if (this.#doingDaily) return;
    clearInterval(this.#timeout);
    this.status = "init";
  }

  /** Calculates the path, duration, and slows for the current iteration. */
  run() {
    const path = findPath(this.grid, this.checkpoint);

    if (!path) {
      console.log(new Date(), this.#logName, "no path?");
      console.log(gridToString(this.grid, undefined, this.checkpoint));
    }

    return [
      path ?? [],
      ...pathDuration(
        path,
        [...this.#thunders, ...this.blocks.filter((b) => b.thunder)],
      ),
    ] as const;
  }

  /**
   * Send's the player the attempts for their daily, which includes the
   * duration, percent, and percentile of feach attempt.
   */
  async #sendDailyTimes(daily?: Daily) {
    daily = daily ?? this.daily;

    const iterationInfo = getDailyIteration(
      daily.year,
      daily.month,
      daily.day,
    ).then((iteration) =>
      iteration
        ? Promise.all([
          getIterationTimeCounts(iteration.iteration),
          getIterationOtherBest(iteration.iteration, this.id, true),
        ])
        : null
    );

    const [timeCountsAndOtherBest, attempts] = await Promise.all([
      iterationInfo,
      dailyAttempts(this.id, daily.year, daily.month, daily.day),
    ]);

    if (!timeCountsAndOtherBest) {
      return this.close("could not get daily time counts");
    }

    const [timeCounts, otherBest] = timeCountsAndOtherBest;

    this.send({
      kind: "daily",
      rating: this.rating,
      attempts: attempts.map((duration) => ({
        duration,
        percentile: percentileFromTimeCounts(timeCounts, duration) ?? NaN,
        supreme: otherBest ? duration > otherBest : true,
      })),
    });
  }

  async #initializeRun(iteration: number) {
    const [details, ownBest] = await Promise.all([
      getIteration(iteration),
      getOwnBest(this.id, iteration),
    ]);
    if (!details) return this.close("missing iteration");

    this.grid = newGrid();
    this.grid[details.checkpoint.y + 0.5][details.checkpoint.x + 0.5] = true;
    for (const { x, y } of details.thunders) {
      offsets.forEach(([xd, yd]) => this.grid[y + yd][x + xd] = true);
    }
    for (const { x, y } of details.blocks) {
      offsets.forEach(([xd, yd]) => this.grid[y + yd][x + xd] = true);
    }

    this.checkpoint = details.checkpoint;
    this.bricks = details.bricks;
    this.bricks = details.bricks;
    this.power = details.power;
    this.blocks = details.blocks;
    this.#thunders = details.thunders;
    this.#iterationMinTime = details.min;
    this.#iterationCreatedAt = details.date;

    return ownBest;
  }

  async playPrevalidate(iteration?: number) {
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
        return this.#sendDailyTimes();
      }
    }

    if (this.#doingDaily) {
      console.log(
        new Date(),
        this.#logName,
        "doing daily, iteration is",
        iteration,
        "for",
        this.daily,
      );
    }

    return iteration;
  }

  /**
   * Attempts to start a new round. This includes
   */
  // TODO: need locking on this entire function
  async play(iteration?: number) {
    iteration = await this.playPrevalidate(iteration) ?? undefined;
    if (iteration === undefined) return;

    clearTimeout(this.#timeout);
    this.status = "loading";

    if (!iteration) iteration = await this.#getRandomIteration();

    const ownBest = await this.#initializeRun(iteration);
    if (ownBest === undefined) return;
    this.#ownBest = ownBest;

    this.#iteration = iteration;
    this.status = "afk";

    if (this.#doingDaily) {
      console.log(
        new Date(),
        this.#logName,
        "playing daily",
        this.daily,
        `(${iteration})`,
        "with",
        this.#remainingDailyAttempts,
        "attempts remaining",
      );
    } else console.log(new Date(), this.#logName, "playing", iteration);

    this.send({
      kind: "start",
      iteration: iteration,
      date: new Date(this.#iterationCreatedAt!).getTime(),
      time: BUILD_TIME,
      checkpoint: this.checkpoint,
      thunders: [
        ...this.#thunders.map(({ x, y }) => ({ x, y, player: undefined })),
        ...this.blocks.filter((b) => b.thunder)
          .map(({ x, y, player }) => ({ x, y, player })),
      ],
      blocks: this.blocks.filter((b) => !b.thunder)
        .map(({ x, y, player }) => ({ x, y, player })),
      power: this.power,
      bricks: this.bricks,
      rating: this.rating,
      todaysRemainingDailyAttempts: this.#remainingDailyAttempts,
      ownBest,
    });

    this.#startTime = Date.now();
    this.#timeout = setTimeout(() => this.startRunner(), BUILD_TIME * 1_000);
  }

  async startRunner() {
    clearTimeout(this.#timeout);
    const minTime = this.#iterationMinTime;
    const iteration = this.#iteration;
    if (iteration === undefined || !minTime) {
      return this.close("missing times");
    }

    const [path, duration, slows] = this.run();

    if (this.status === "playing" || this.#doingDaily) {
      runEvents([{ userId: this.id, iteration, duration }]);
      const serializedRun = this.blocks.filter((b) => b.player).map((b) =>
        `${b.thunder ? "t" : ""}${b.x.toString().padStart(2, "0")}${b.y}`
      ).join("\n");
      await logRun(
        iteration,
        this.id,
        duration,
        this.status !== "playing",
        serializedRun,
      );
    }

    if (this.#doingDaily && this.#remainingDailyAttempts === 1) {
      await markDaily(this.id, iteration);
    }

    const [timeCounts, max, otherBest] = await Promise.all([
      getIterationTimeCounts(iteration),
      getMaxIterationTime(iteration),
      getIterationOtherBest(iteration, this.id),
    ]);
    // Maps 415 -> 0.25, 1000 -> 0.5, 2000 -> 0.75, 3000 -> 0.875
    const expectedPercentile = 1 - 0.5 ** (this.rating / 1_000);
    const percentile = percentileFromTimeCounts(timeCounts, duration);

    this.send({
      kind: "run",
      iteration,
      path: path ?? [],
      duration,
      percentile,
      percent: (duration - minTime) / (Math.max(max ?? 0, duration) - minTime),
      slows,
      rating: this.rating,
      supreme: duration > (otherBest ?? 0),
    });

    if (this.#doingDaily && this.#remainingDailyAttempts === 1) {
      console.log(new Date(), this.#logName, "daily complete, logging result");

      const attempts = await dailyAttemptsByIteration(this.id, iteration);

      if (timeCounts.length > 0) {
        const best = Math.max(...attempts);
        // Note: timeCounts has a length, so actualPercentile shouldn't ever fallback
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
    if (this.#deleteTimeout === undefined) {
      this.#timeout = setTimeout(() => this.play(), duration * 1_000);
    }
  }

  #iterationCount = NaN;
  async #getRandomIteration() {
    if (isNaN(this.#iterationCount)) {
      this.#iterationCount = await getIterationCount();
    }

    return Math.ceil(Math.random() * this.#iterationCount);
  }

  static from(socket: WebSocket) {
    return Player.map.get(socket);
  }

  static revive(
    ...[websocket, id, username, rating, plays, remainingDailyAttempts, daily]:
      ConstructorParameters<typeof Player>
  ): Player | undefined {
    for (const player of this.map.values()) {
      if (player.id !== id) continue;

      const oldWebsocket = player.#websocket;
      player.#websocket = websocket;
      player.username = username;
      player.rating = rating;
      player.plays = plays;
      player.#remainingDailyAttempts = remainingDailyAttempts;
      player.daily = daily;

      clearTimeout(player.#deleteTimeout);
      player.#deleteTimeout = undefined;

      Player.map.delete(oldWebsocket);
      Player.map.set(websocket, player);

      if (player.status === "init") {
        if (player.#doingDaily) player.play();
        else player.#sendDailyTimes();
      } else {
        if (!player.#doingDaily) {
          listDailies(player.id).then((items) =>
            player.send({ kind: "list", items })
          );
        }

        player.send({
          kind: "start",
          iteration: player.#iteration!,
          date: new Date(player.#iterationCreatedAt!).getTime(),
          time: BUILD_TIME - (Date.now() - player.#startTime!) / 1_000,
          checkpoint: player.checkpoint,
          thunders: [
            ...player.#thunders
              .map(({ x, y }) => ({ x, y, player: undefined })),
            ...player.blocks.filter((b) => b.thunder)
              .map(({ x, y, player }) => ({ x, y, player })),
          ],
          blocks: player.blocks.filter((b) => !b.thunder)
            .map(({ x, y, player }) => ({ x, y, player })),
          power: player.power,
          bricks: player.bricks,
          rating: player.rating,
          todaysRemainingDailyAttempts: player.#remainingDailyAttempts,
          ownBest: player.#ownBest,
        });
      }

      return player;
    }
  }
}
