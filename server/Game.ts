import { Message } from "../common/serverToClientMessage.ts";
import { Point } from "../common/types.ts";
import { offsets } from "./constants.ts";
import type { Player } from "./Player.ts";
import { isLeader } from "./trackLeadership.ts";

type Status = "idle" | "build" | "run";

class Game {
  #players = new Set<Player>();
  #queuedPlayers = new Set<Player>();
  #status: Status = "idle";
  #started = false;
  #grid = Array.from(Array(20), () => Array<boolean>(20).fill(false));

  start() {
    if (this.#started || this.#status !== "idle" || !isLeader()) return;

    this.#queuedPlayers.forEach((player) => this.#players.add(player));
    this.#queuedPlayers.clear();

    if (this.#players.size === 0) return;

    console.log(new Date(), "Starting loop");

    this.#started = true;

    this.#startRound();
  }

  #startRound() {
    if (this.#status !== "idle") return;
    this.#status = "build";

    console.log(new Date(), "Starting round");

    this.#queuedPlayers.forEach((player) => this.#players.add(player));
    this.#queuedPlayers.clear();

    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) this.#grid[y][x] = false;
    }

    const checkpoint = {
      x: 1.5 + Math.floor(Math.random() * 18),
      y: 1.5 + Math.floor(Math.random() * 18),
    };
    this.#grid[checkpoint.y + 0.5][checkpoint.x + 0.5] = true;

    let r = Math.random();
    let n = r < 0.01 ? 2 : r < 0.1 ? 1 : 0;
    const thunders: Point[] = [];
    while (n--) {
      const x = 2 + Math.floor(Math.random() * 17);
      const y = 2 + Math.floor(Math.random() * 17);

      if (offsets.some(([xd, yd]) => this.#grid[y + yd][x + xd])) continue;

      offsets.forEach(([xd, yd]) => this.#grid[y + yd][x + xd] = true);
      thunders.push({ x, y });
    }

    n = Math.floor(Math.random() * Math.random() * 49);
    const blocks: Point[] = [];
    while (n--) {
      const x = 2 + Math.floor(Math.random() * 17);
      const y = 2 + Math.floor(Math.random() * 17);

      if (offsets.some(([xd, yd]) => this.#grid[y + yd][x + xd])) continue;

      offsets.forEach(([xd, yd]) => this.#grid[y + yd][x + xd] = true);
      blocks.push({ x, y });
    }

    r = Math.random();
    const power = r < 0.01 ? 2 : r < 0.1 ? 1 : 0;
    const bricks = power + Math.floor(Math.random() * Math.random() * 20) + 3;

    for (const player of this.#players) {
      player.grid = this.#grid;
      player.bricks = bricks;
      player.power = power;
    }

    this.broadcast({
      kind: "start",
      checkpoint,
      thunders,
      blocks,
      power,
      bricks,
    });

    setTimeout(() => this.#startRunners(), 60_000);
  }

  broadcast(message: Message) {
    for (const player of this.#players) player.send(message);
    for (const player of this.#queuedPlayers) player.send(message);
  }

  #startRunners() {
    this.#status = "run";
    console.log(new Date(), "Starting run");

    setTimeout(() => {
      this.#status = "idle";
      setTimeout(() => {
        this.#startRound();
      }, 500);
    }, 1_000);
  }

  addPlayer(player: Player) {
    if (this.#status === "idle") {
      this.#players.add(player);
      if (isLeader() && !this.#started) this.start();
    } else this.#queuedPlayers.add(player);
  }

  removePlayer(player: Player) {
    if (this.#players.has(player)) {
      this.#players.delete(player);
      if (this.#players.size === 0) {
        console.log(new Date(), "No players remaining, ending round early");
        this.#status = "idle";
        this.#started = false;
        if (this.#queuedPlayers.size > 0) this.start();
      }
    } else if (this.#queuedPlayers.has(player)) {
      this.#queuedPlayers.delete(player);
    }
  }
}

export const game = new Game();
