import { BlockMessage, LoginMessage } from "../common/clientToServerMessage.ts";
import { offsets } from "./constants.ts";
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
  block: (socket: WebSocket, { x, y }: BlockMessage) => {
    const player = Player.from(socket);

    if (!player) {
      console.log(new Date(0), "Closing missing player");
      return socket.close();
    }

    if (player.bricks === 0) return player.close("no bricks");

    if (offsets.some(([xd, yd]) => player.grid[y + yd]?.[x + xd] !== false)) {
      return player.close("invalid placement");
    }

    offsets.forEach(([xd, yd]) => player.grid[y + yd][x + xd] = true);
    player.bricks--;
  },
};
