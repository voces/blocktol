import { findPath } from "../common/pathing.ts";
import { Message } from "../common/serverToClientMessage.ts";
import { Point } from "../common/types.ts";
import { game } from "./Game.ts";

export class Player {
  #websocket: WebSocket;
  grid: boolean[][] = [];
  checkpoint: Point = { x: 0, y: 0 };
  blocks: (Point & { thunder?: boolean })[] = [];
  bricks = 0;
  power = 0;
  unranked = false;

  private static map = new WeakMap<WebSocket, Player>();

  constructor(
    websocket: WebSocket,
    readonly id: string,
    readonly username: string,
    readonly rating: number,
  ) {
    this.#websocket = websocket;
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
  }

  send(message: Message) {
    this.#websocket.send(JSON.stringify(message));
  }

  close(reason: string) {
    console.log(new Date(), "Closing", reason);
    this.#websocket.close();
  }

  findPath() {
    return findPath(this.grid, this.checkpoint) ?? [];
  }

  static from(socket: WebSocket) {
    return Player.map.get(socket);
  }
}
