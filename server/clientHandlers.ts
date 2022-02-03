import {
  BlockMessage,
  LoginMessage,
  TransitionBlockMessage,
} from "../common/clientToServerMessage.ts";
import { findPath } from "../common/pathing.ts";
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

    if (!findPath(player.grid, player.checkpoint)) {
      return player.close("invalid placement");
    }

    player.blocks.push({ x, y });
    player.bricks--;
  },
  transition: (socket: WebSocket, { x, y }: TransitionBlockMessage) => {
    const player = Player.from(socket);

    if (!player) {
      console.log(new Date(0), "Closing missing player");
      return socket.close();
    }

    const block = player.blocks.find((b) => b.x === x && b.y === y);

    if (!block) {
      return player.close("invalid block");
    }

    if (player.power) {
      // TODO: mark as thunder?
      player.power--;
      return;
    }

    offsets.forEach(([xd, yd]) => player.grid[y + yd][x + xd] = false);

    player.bricks++;
    player.blocks.splice(player.blocks.indexOf(block), 1);
  },
};
