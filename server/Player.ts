import { Message } from "../common/serverToClientMessage.ts";
import { game } from "./Game.ts";

export class Player {
  #websocket: WebSocket;
  grid: boolean[][] = [];
  bricks = 0;
  power = 0;

  private static map = new WeakMap<WebSocket, Player>();

  constructor(
    websocket: WebSocket,
    readonly id: string,
    readonly username: string,
  ) {
    this.#websocket = websocket;
    websocket.addEventListener("close", () => game.removePlayer(this));

    Player.map.set(websocket, this);
  }

  send(message: Message) {
    this.#websocket.send(JSON.stringify(message));
  }

  close(reason: string) {
    console.log(new Date(), "Closing", reason);
    this.#websocket.close();
  }

  static from(socket: WebSocket) {
    return Player.map.get(socket);
  }
}
