import { Message } from "../common/serverToClientMessage.ts";
import { game } from "./Game.ts";

export class Player {
  #websocket: WebSocket;

  constructor(
    websocket: WebSocket,
    readonly id: string,
    readonly username: string,
  ) {
    this.#websocket = websocket;
    websocket.addEventListener("close", () => game.removePlayer(this));
  }

  send(message: Message) {
    this.#websocket.send(JSON.stringify(message));
  }
}
