import { LoginMessage } from "../common/clientToServerMessage.ts";
import { game } from "./Game.ts";
import { Player } from "./Player.ts";

export const clientHandlers = {
  login: (socket: WebSocket, message: LoginMessage) => {
    console.log(
      new Date(),
      `'${message.id.slice(0, 8)}...${
        message.id.slice(-8)
      }' logged in as ${message.username}`,
    );
    game.addPlayer(new Player(socket, message.id, message.username));
  },
};
