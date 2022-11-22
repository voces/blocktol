import {
  BlockMessage,
  ChatMessage,
  LoginMessage,
  TransitionBlockMessage,
} from "../common/clientToServerMessage.ts";
import { offsets } from "../common/constants.ts";
import { findPath } from "../common/pathing.ts";
import { createOrUpdateUser, dailyAttempts, getUserPlays } from "./db/user.ts";
import { game } from "./Game.ts";
import { Player } from "./Player.ts";

const EIGHT_HOURS = 8 * 60 * 60 * 1_000;

const loginDate = (date: LoginMessage["date"]) => {
  const d = new Date(date.year, date.month - 1, date.day);
  const now = Date.now();
  if (Math.abs(d.getTime() - now) > EIGHT_HOURS) return new Date();
  return d;
};

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

    const localDate = loginDate(message.date);
    const year = localDate.getFullYear();
    const month = localDate.getMonth() + 1;
    const date = localDate.getDate();
    const remainingDailyAttempts = 3 - (await dailyAttempts(
      message.id,
      year,
      month,
      date,
    )).length;

    game.addPlayer(
      new Player(
        socket,
        message.id,
        name,
        rating,
        plays,
        remainingDailyAttempts,
        { year, month, date },
      ),
    );
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
      return player.close(`invalid placement (grid=(${x},${y}))`);
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
  chat: (socket: WebSocket, { message }: ChatMessage) => {
    const player = Player.from(socket);

    if (!player) {
      console.log(new Date(0), "Closing missing player");
      return socket.close();
    }

    if (message.length > 100) return player.close("invalid chat message");

    game.chat(player, message);
  },
};
