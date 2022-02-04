import { offsets } from "../common/constants.ts";
import { findPath, newGrid } from "../common/pathing.ts";
import { Message, StartMessage } from "../common/serverToClientMessage.ts";
import { Point } from "../common/types.ts";
import { broadcast } from "./channel.ts";
import type { Player } from "./Player.ts";
import { isLeader } from "./trackLeadership.ts";

type Status = "idle" | "build" | "run";

const BUILD_TIME = 60;

class Game {
  #players = new Set<Player>();
  #status: Status = "idle";
  #started = false;

  #start = 0;
  #checkpoint = { x: 0, y: 0 };
  #blocks: Point[] = [];
  #thunders: Point[] = [];
  #bricks = 0;
  #power = 0;

  #grid: boolean[][] = [];
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

  #startRound() {
    if (this.#status !== "idle") return;
    this.#status = "build";

    console.log(new Date(), "Starting round");

    this.#start = Date.now();

    this.#grid = newGrid();

    this.#checkpoint = {
      x: 1.5 + Math.floor(Math.random() * 17),
      y: 1.5 + Math.floor(Math.random() * 17),
    };
    this.#grid[this.#checkpoint.y + 0.5][this.#checkpoint.x + 0.5] = true;

    let r = Math.random();
    let n = r < 0.01 ? 2 : r < 0.1 ? 1 : 0;
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

    n = Math.floor(Math.random() * Math.random() * 49);
    this.#blocks = [];
    while (n--) {
      const x = 2 + Math.floor(Math.random() * 17);
      const y = 2 + Math.floor(Math.random() * 17);

      if (offsets.some(([xd, yd]) => this.#grid[y + yd][x + xd])) continue;

      offsets.forEach(([xd, yd]) => this.#grid[y + yd][x + xd] = true);

      if (!findPath(this.#grid, this.#checkpoint)) {
        offsets.forEach(([xd, yd]) => this.#grid[y + yd][x + xd] = false);
      } else this.#blocks.push({ x, y });
    }

    const path = findPath(this.#grid, this.#checkpoint);
    console.log(
      this.#grid.map((r, y) =>
        r.map((v, x) =>
          (this.#checkpoint.x + 0.5 === x && this.#checkpoint.y + 0.5 === y)
            ? "X"
            : v
            ? "█"
            : path?.some((p) => p.x === x && p.y === y)
            ? "O"
            : " "
        ).join("")
      ).join("\n"),
    );

    r = Math.random();
    this.#power = r < 0.01 ? 2 : r < 0.1 ? 1 : 0;
    this.#bricks = this.#power +
      Math.floor(Math.random() * Math.random() * 20) + 3;

    for (const player of this.#players) {
      player.startRound(
        this.#grid.map((r) => [...r]),
        this.#checkpoint,
        this.#bricks,
        this.#power,
      );
    }

    this.broadcast({
      kind: "start",
      time: BUILD_TIME,
      checkpoint: this.#checkpoint,
      thunders: this.#thunders,
      blocks: this.#blocks,
      power: this.#power,
      bricks: this.#bricks,
    });

    this.#timeout = setTimeout(() => this.#startRunners(), BUILD_TIME * 1_000);
  }

  broadcast(message: Message) {
    for (const player of this.#players) player.send(message);
  }

  #startRunTimeout(timeout: number) {
    this.timeoutStart = Date.now();
    this.#timeout = setTimeout(() => {
      console.log(new Date(), "Finished run");
      this.#status = "idle";
      this.#timeout = setTimeout(() => {
        this.#startRound();
      }, 500);
    }, timeout);
  }

  #startRunners() {
    this.#max = -Infinity;
    for (const player of this.#players) {
      const path = player.findPath();
      const duration = path.length * 0.2;
      if (duration > this.#max) this.#max = duration;
      player.send({ kind: "run", path, duration });

      // A player is unranked for a round if they join in the middle of it
      if (player.unranked) {
        player.unranked = true;
      }
    }

    broadcast({ kind: "startRun", max: this.#max });

    console.log(new Date(), "Start run, best is", this.#max);

    this.#startRunTimeout(this.#max * 1_000);
  }

  runBeat(max: number) {
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

  startRunnersFromState(max: number) {
    let beat = false;

    for (const player of this.#players) {
      const path = player.findPath();
      const duration = path.length * 0.2;
      if (duration > max) {
        max = duration;
        beat = true;
      }
    }

    if (beat) broadcast({ kind: "runBeat", max });
  }

  addPlayer(player: Player) {
    this.#players.add(player);
    if (this.#status === "idle") {
      if (isLeader() && !this.#started) this.start();
    } else {
      player.unranked = true;
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
