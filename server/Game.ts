import { offsets } from "../common/constants.ts";
import { gridToString } from "../common/gridToString.ts";
import { findPath, newGrid, pathDuration } from "../common/pathing.ts";
import { Message, StartMessage } from "../common/serverToClientMessage.ts";
import { Point } from "../common/types.ts";
import { broadcast } from "./channel.ts";
import {
  createIteration,
  getIteration,
  getIterationCount,
  getIterationTimes,
  logRuns,
} from "./db/iteration.ts";
import type { Player } from "./Player.ts";
import { PlayerRunsMessage } from "./ServerMessage.ts";
import { isLeader } from "./trackLeadership.ts";

type Status = "idle" | "build" | "run";

const BUILD_TIME = 60;

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

  #playerRuns: PlayerRunsMessage["playerRuns"] = [];

  #start = 0;
  #max = -Infinity;
  #timeout = 0;
  timeoutStart = 0;

  start() {
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

    const avg = Array.from(this.#players).reduce((sum, p) => sum + p.plays, 0) /
      this.#players.size;
    const newIteration =
      Math.random() < ((avg + 100) / (this.#iterationCount || 1)) ** 4 /
          (this.#iterationCount || 1);

    if (newIteration) {
      this.#checkpoint = {
        x: 1.5 + Math.floor(Math.random() * 17),
        y: 1.5 + Math.floor(Math.random() * 17),
      };
      this.#grid[this.#checkpoint.y + 0.5][this.#checkpoint.x + 0.5] = true;

      let r = Math.random();
      let n = r < 0.04 ? 2 : r < 0.2 ? 1 : 0;
      this.#thunders = [];
      while (n--) {
        const x = 2 + Math.floor(Math.random() * 17);
        const y = 2 + Math.floor(Math.random() * 17);

        if (offsets.some(([xd, yd]) => this.#grid[y + yd][x + xd])) continue;

        offsets.forEach(([xd, yd]) => this.#grid[y + yd][x + xd] = true);

        if (!findPath(this.#grid, this.#checkpoint)) {
          offsets.forEach(([xd, yd]) => this.#grid[y + yd][x + xd] = false);
        } else this.#thunders.push({ x, y });
      }

      n = Math.floor((1 - Math.random()) ** 0.5 * 49);
      this.#blocks = [];
      while (n-- > 0 || this.#blocks.length === 0) {
        const x = 2 + Math.floor(Math.random() * 17);
        const y = 2 + Math.floor(Math.random() * 17);

        if (offsets.some(([xd, yd]) => this.#grid[y + yd][x + xd])) continue;

        offsets.forEach(([xd, yd]) => this.#grid[y + yd][x + xd] = true);

        if (!findPath(this.#grid, this.#checkpoint)) {
          offsets.forEach(([xd, yd]) => this.#grid[y + yd][x + xd] = false);
        } else this.#blocks.push({ x, y });
      }

      r = Math.random();
      this.#power = r < 0.09 ? 2 : r < 0.3 ? 1 : 0;
      this.#bricks = this.#power +
        Math.floor((1 - Math.random() ** 0.7) * 20) + 3;

      this.#iteration = await createIteration(
        this.#bricks,
        this.#power,
        this.#checkpoint,
        this.#blocks,
        this.#thunders,
      );
      this.#iterationCount++;

      this.#times = Promise.resolve([]); // new iteration; no times
    } else {
      this.#iteration = Math.floor(Math.random() * this.#iterationCount) + 1;

      const values = await getIteration(this.#iteration);
      this.#checkpoint = values.checkpoint;
      this.#power = values.power;
      this.#thunders = values.thunders;
      this.#bricks = values.bricks;
      this.#blocks = values.blocks;

      this.#grid[this.#checkpoint.y + 0.5][this.#checkpoint.x + 0.5] = true;
      this.#blocks.forEach(({ x, y }) =>
        offsets.forEach(([xd, yd]) => this.#grid[y + yd][x + xd] = true)
      );
      this.#thunders.forEach(({ x, y }) =>
        offsets.forEach(([xd, yd]) => this.#grid[y + yd][x + xd] = true)
      );

      this.#times = getIterationTimes(this.#iteration);
    }

    console.log(new Date(), `Starting round. iteration=${this.#iteration}`);

    const path = findPath(this.#grid, this.#checkpoint) ?? [];
    const [duration] = pathDuration(path, this.#thunders);
    this.#minTime = duration;

    console.log(gridToString(this.#grid, path, this.#checkpoint));

    for (const player of this.#players) {
      player.startRound(
        this.#grid.map((r) => [...r]),
        this.#checkpoint,
        this.#bricks,
        this.#power,
        this.#thunders,
      );

      player.send({
        kind: "start",
        time: BUILD_TIME,
        checkpoint: this.#checkpoint,
        thunders: this.#thunders,
        blocks: this.#blocks,
        power: this.#power,
        bricks: this.#bricks,
        minTime: this.#minTime,
        rating: player.rating,
      });
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
      const duration = player.run(times, this.#minTime);

      if (duration > this.#max) this.#max = duration;

      this.#playerRuns.push({
        player: player.id,
        rating: player.rating,
        duration,
      });
    }

    broadcast({ kind: "startRun", times });

    console.log(new Date(), "Start run, local best is", this.#max);

    this.#startRunTimeout(this.#max * 1_000);
  }

  playerRuns(playerRuns: PlayerRunsMessage["playerRuns"]) {
    let max = -Infinity;

    for (const run of playerRuns) {
      if (run.duration > max) max = run.duration;
      this.#playerRuns.push(run);
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

    broadcast(state);
    this.broadcast(state);
  }

  startRunnersFromState(times: number[]) {
    const playerRuns: PlayerRunsMessage["playerRuns"] = [];

    for (const player of this.#players) {
      const duration = player.run(times, this.#minTime);

      playerRuns.push({
        player: player.id,
        rating: player.rating,
        duration,
      });
    }

    broadcast({ kind: "playerRuns", playerRuns });
  }

  addPlayer(player: Player) {
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
}

export const game = new Game();
