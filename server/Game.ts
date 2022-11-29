import { offsets } from "../common/constants.ts";
import { gridToString } from "../common/gridToString.ts";
import { findPath, newGrid, pathDuration } from "../common/pathing.ts";
import { Message, StartMessage } from "../common/serverToClientMessage.ts";
import { Point } from "../common/types.ts";
import { broadcast } from "./channel.ts";
import {
  getDailyIteration,
  getIteration,
  getIterationCount,
  getIterationTimes,
  logRuns,
} from "./db/iteration.ts";
import { CHAT_TOKEN_MAX, Player, TOKEN_MAX } from "./Player.ts";
import { PlayerRunsMessage } from "./ServerMessage.ts";
import { isLeader } from "./trackLeadership.ts";
import { newIteration } from "./util/newIteration.ts";

type Status = "idle" | "build" | "run";

export const BUILD_TIME = 60;
const ONE_SECOND = 1_000;
const ONE_MINUTE = 60 * ONE_SECOND;
const ONE_DAY = ONE_MINUTE * 60 * 24;

class Game {
  #players = new Set<Player>();
  #status: Status = "idle";
  #started = false;
  #iterationCount?: number;

  #checkpoint = { x: 0, y: 0 };
  #iteration = -1;
  #blocks: Point[] = [];
  #thunders: Point[] = [];
  #bricks = 0;
  #power = 0;
  #grid: boolean[][] = [];
  #times: Promise<number[]> = Promise.resolve([]);
  #minTime = 0;
  #date = 0;

  #playerRuns: Omit<PlayerRunsMessage["playerRuns"][number], "log">[] = [];

  #start = 0;
  #max = -Infinity;
  #timeout = 0;
  timeoutStart = 0;

  constructor() {
    setInterval(() => {
      for (const player of this.#players) {
        player.tokens = Math.min(player.tokens + 1, TOKEN_MAX);
        player.chatTokens = Math.min(player.chatTokens + 1, CHAT_TOKEN_MAX);
      }
    }, ONE_SECOND);
  }

  start(electedLeader = false) {
    if (electedLeader) {
      const todayDate = new Date();
      const now = todayDate.getTime();
      const yesterdayDate = new Date(now - ONE_DAY);
      const tomorrowDate = new Date(now + ONE_DAY);
      const overmorrowDate = new Date(now + ONE_DAY * 2);

      (async () => {
        for (
          const date of [yesterdayDate, todayDate, tomorrowDate, overmorrowDate]
        ) {
          const iteration = await getDailyIteration(
            date.getFullYear(),
            date.getMonth() + 1,
            date.getDate(),
          );

          if (!iteration) await newIteration(date);
        }
      })();

      setInterval(async () => {
        const overmorrowDate = new Date(Date.now() + ONE_DAY * 2);

        const iteration = await getDailyIteration(
          overmorrowDate.getFullYear(),
          overmorrowDate.getMonth() + 1,
          overmorrowDate.getDate(),
        );

        if (!iteration) {
          await newIteration(overmorrowDate);
          this.#iterationCount = await getIterationCount();
        }
      }, ONE_MINUTE);
    }

    if (this.#started || this.#status !== "idle" || !isLeader()) return;

    if (this.#players.size === 0) return;

    console.log(new Date(), "Starting loop");

    this.#started = true;

    this.#startRound();
  }

  async #startRound() {
    if (this.#status !== "idle" || this.#players.size === 0) return;
    this.#status = "build";

    if (!this.#iterationCount) {
      this.#iterationCount = await getIterationCount();
    }

    this.#start = Date.now();

    this.#grid = newGrid();
    this.#playerRuns = [];

    this.#iteration = Math.floor(Math.random() * (this.#iterationCount - 3)) +
      1;

    const values = await getIteration(this.#iteration);
    this.#checkpoint = values.checkpoint;
    this.#power = values.power;
    this.#thunders = values.thunders;
    this.#bricks = values.bricks;
    this.#blocks = values.blocks;
    this.#date = new Date(values.date).getTime();

    this.#grid[this.#checkpoint.y + 0.5][this.#checkpoint.x + 0.5] = true;
    this.#blocks.forEach(({ x, y }) =>
      offsets.forEach(([xd, yd]) => this.#grid[y + yd][x + xd] = true)
    );
    this.#thunders.forEach(({ x, y }) =>
      offsets.forEach(([xd, yd]) => this.#grid[y + yd][x + xd] = true)
    );

    this.#times = getIterationTimes(this.#iteration);

    console.log(new Date(), `Starting round. iteration=${this.#iteration}`);

    const path = findPath(this.#grid, this.#checkpoint) ?? [];
    const [duration] = pathDuration(path, this.#thunders);
    this.#minTime = duration;

    console.log(gridToString(this.#grid, path, this.#checkpoint));

    const message = {
      kind: "start",
      date: this.#date,
      time: BUILD_TIME,
      checkpoint: this.#checkpoint,
      thunders: this.#thunders,
      blocks: this.#blocks,
      power: this.#power,
      bricks: this.#bricks,
      minTime: this.#minTime,
    } as const;

    broadcast(message);

    for (const player of this.#players) {
      player.startRound(
        this.#grid.map((r) => [...r]),
        this.#checkpoint,
        this.#bricks,
        this.#power,
        this.#thunders,
      );

      player.send({ ...message, rating: player.rating });
    }

    this.#timeout = setTimeout(() => this.#startRunners(), BUILD_TIME * 1_000);
  }

  broadcast(message: Message) {
    for (const player of this.#players) player.send(message);
  }

  #startRunTimeout(timeout: number) {
    this.timeoutStart = Date.now();
    this.#timeout = setTimeout(async () => {
      console.log(new Date(), "Finished run");
      this.#status = "idle";

      if (this.#playerRuns.length > 0) {
        await logRuns(this.#playerRuns, this.#iteration);
      }

      this.#startRound();
    }, timeout);
  }

  async #startRunners() {
    const times = await this.#times;

    this.#max = -Infinity;
    for (const player of this.#players) {
      const [duration, percentile, log] = player.run(times, this.#minTime);

      if (duration > this.#max) this.#max = duration;

      if (log) {
        this.#playerRuns.push({
          player: player.id,
          rating: player.rating,
          duration,
        });

        for (const p2 of this.#players) {
          if (p2 !== player && p2.tokens === 0) continue;
          p2.sendRunLog(player.username, duration, percentile);
          if (p2 !== player) p2.tokens--;
        }
      } else player.sendRunLog(player.username, duration, percentile);
    }

    broadcast({ kind: "startRun", times });

    console.log(new Date(), "Start run, local best is", this.#max);

    this.#startRunTimeout(this.#max * 1_000);
  }

  playerRuns(playerRuns: PlayerRunsMessage["playerRuns"]) {
    let max = -Infinity;

    for (const run of playerRuns) {
      if (run.duration > max) max = run.duration;
      if (run.log) this.#playerRuns.push(run);
    }

    if (max < this.#max) return;

    const remaining = this.timeoutStart + this.#max * 1_000 - Date.now();
    const extension = max - this.#max;
    const newTimeout = remaining + extension * 1_000;
    this.#max = max;

    console.log(
      new Date(),
      "New best of",
      this.#max,
      "from node, extending",
      extension,
    );

    clearTimeout(this.#timeout);
    this.#startRunTimeout(newTimeout);
  }

  startFromState(state: StartMessage) {
    this.#checkpoint = state.checkpoint;
    this.#thunders = state.thunders;
    this.#blocks = state.blocks;
    this.#bricks = state.bricks;
    this.#power = state.power;
    this.#minTime = state.minTime;
    this.#date = state.date;

    this.#grid = newGrid();

    this.#grid[state.checkpoint.y + 0.5][state.checkpoint.x + 0.5] = true;
    for (const { x, y } of state.thunders) {
      offsets.forEach(([xd, yd]) => this.#grid[y + yd][x + xd] = true);
    }
    for (const { x, y } of state.blocks) {
      offsets.forEach(([xd, yd]) => this.#grid[y + yd][x + xd] = true);
    }

    for (const player of this.#players) {
      player.grid = this.#grid.map((r) => [...r]);
      player.checkpoint = state.checkpoint;
      player.bricks = state.bricks;
      player.power = state.power;
    }

    this.broadcast(state);
  }

  startRunnersFromState(times: number[]) {
    const playerRuns: PlayerRunsMessage["playerRuns"] = [];

    for (const player of this.#players) {
      const [duration, percentile, log] = player.run(times, this.#minTime);

      playerRuns.push({
        player: player.id,
        rating: player.rating,
        duration,
        log,
      });

      if (log) {
        for (const p2 of this.#players) {
          if (p2 !== player && p2.tokens === 0) continue;
          p2.sendRunLog(player.username, duration, percentile);
          if (p2 !== player) p2.tokens--;
        }
      } else player.sendRunLog(player.username, duration, percentile);
    }

    broadcast({ kind: "playerRuns", playerRuns });
  }

  addPlayer(player: Player, skipMessage = false) {
    if (player.remainingDailyAttempts > 0) {
      player.dailyStep();
      player.send({
        kind: "log",
        source: "server",
        time: Date.now(),
        message:
          `Welcome \\c${player.username}\\c! You have ${player.remainingDailyAttempts} remaining attempts on your daily maze.`,
      });
      return;
    }

    player.sendDailyTimes();

    this.#players.add(player);
    if (this.#status === "idle") {
      if (isLeader() && !this.#started) this.start();
    } else {
      player.status = "midjoin";
      player.grid = this.#grid.map((r) => [...r]);
      player.checkpoint = this.#checkpoint;
      player.bricks = this.#bricks;
      player.power = this.#power;

      player.send({
        kind: "start",
        date: this.#date,
        time: (this.#start + BUILD_TIME * 1_000 - Date.now()) / 1_000,
        checkpoint: this.#checkpoint,
        thunders: this.#thunders,
        blocks: this.#blocks,
        power: this.#power,
        bricks: this.#bricks,
        minTime: this.#minTime,
        rating: player.rating,
      });
    }

    if (!skipMessage) {
      player.send({
        kind: "log",
        source: "server",
        time: Date.now(),
        message: `Welcome \\c${player.username}\\c${
          this.#players.size === 1
            ? "!"
            : `, there ${this.#players.size === 2 ? "is" : "are"} ${
              this.#players.size - 1
            } other player${
              this.#players.size === 2 ? "" : "s"
            } on your server!`
        }`,
      });
    }
  }

  removePlayer(player: Player) {
    if (!this.#players.has(player)) return;

    this.#players.delete(player);
    if (this.#players.size === 0) {
      console.log(new Date(), "No players remaining, ending round early");
      this.#status = "idle";
      this.#started = false;
      clearTimeout(this.#timeout);
    }
  }

  chat(player: Player, message: string, self = false) {
    const now = Date.now();

    // Doing daily or just self
    if (!this.#players.has(player) || self) {
      player.send({
        kind: "log",
        source: player.username.replace(/^server$/, "_server"),
        time: now,
        message,
      });
      return;
    }

    for (const p2 of this.#players) {
      if (p2 !== player && p2.tokens === 0) continue;
      p2.send({
        kind: "log",
        source: player.username.replace(/^server$/, "_server"),
        time: now,
        message,
      });
      if (p2 !== player) p2.tokens--;
    }
  }
}

export const game = new Game();
