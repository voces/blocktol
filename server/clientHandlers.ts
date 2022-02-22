import {
  BlockMessage,
  LoginMessage,
  TransitionBlockMessage,
} from "../common/clientToServerMessage.ts";
import { offsets } from "../common/constants.ts";
import { findPath } from "../common/pathing.ts";
import { createOrUpdateUser, getUserPlays } from "./db/user.ts";
import { game } from "./Game.ts";
import { Player } from "./Player.ts";

export const clientHandlers = {
  login: async (socket: WebSocket, message: LoginMessage) => {
    const [{ rating, name }, plays] = await Promise.all([
      createOrUpdateUser(message.id, message.username),
      getUserPlays(message.id),
    ]);
    console.log(
      new Date(),
      `'${message.id.slice(0, 8)}...${
        message.id.slice(-8)
      }' logged in as ${name} (${rating.toFixed(0)} rating, ${plays} plays)`,
    );
    game.addPlayer(new Player(socket, message.id, name, rating, plays));
  },
  block: (socket: WebSocket, { x, y }: BlockMessage) => {
    const player = Player.from(socket);

    if (!player) {
      console.log(new Date(0), "Closing missing player");
      return socket.close();
    }

    if (player.status === "afk") player.status = "playing";

    if (player.bricks === 0) return player.close("no bricks");

    if (offsets.some(([xd, yd]) => player.grid[y + yd]?.[x + xd] !== false)) {
      return player.close("invalid placement (grid)");
    }

    offsets.forEach(([xd, yd]) => player.grid[y + yd][x + xd] = true);

    const path = findPath(player.grid, player.checkpoint);
    if (!path) return player.close("invalid placement (path)");

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

    if (player.power && !block.thunder) {
      block.thunder = true;
      player.power--;
      return;
    }

    offsets.forEach(([xd, yd]) => player.grid[y + yd][x + xd] = false);

    player.bricks++;
    if (block.thunder) player.power++;
    player.blocks.splice(player.blocks.indexOf(block), 1);
  },
};
