import {
  BlockMessage,
  LoginMessage,
  PlayMessage,
  TransitionBlockMessage,
} from "../common/clientToServerMessage.ts";
import { offsets } from "../common/constants.ts";
import { findPath } from "../common/pathing.ts";
import {
  createOrUpdateUser,
  dailyAttempts,
  getUserPlays,
  listDailies,
} from "./db/user.ts";
import { Player } from "./Player.ts";
import { loginEvent } from "./util/metrics.ts";

export const clientHandlers = {
  login: async (socket: WebSocket, message: LoginMessage) => {
    const [{ rating, name }, plays] = await Promise.all([
      createOrUpdateUser(message.id, message.username),
      getUserPlays(message.id),
    ]);
    loginEvent(message.id);
    console.log(
      new Date(),
      `'${message.id.slice(0, 8)}...${
        message.id.slice(-8)
      }' logged in as ${name} (${rating.toFixed(0)} rating, ${plays} plays)`,
    );

    let parts: string[];
    try {
      parts = new Date().toLocaleDateString("en-US", {
        timeZone: message.timeZone,
      }).split("/");
    } catch (err) {
      console.error(err);
      return socket.close();
    }

    const month = parseInt(parts[0]);
    const day = parseInt(parts[1]);
    const year = parseInt(parts[2]);
    const remainingDailyAttempts = 3 - (await dailyAttempts(
      message.id,
      year,
      month,
      day,
    )).length;

    if (
      Player.revive(
        socket,
        message.id,
        name,
        rating,
        plays,
        remainingDailyAttempts,
        { year, month, day },
      )
    ) return;

    new Player(
      socket,
      message.id,
      name,
      rating,
      plays,
      remainingDailyAttempts,
      { year, month, day },
    );
  },
  block: (socket: WebSocket, { x, y }: BlockMessage) => {
    const player = Player.from(socket);

    if (!player) {
      console.log(new Date(), "Closing missing player");
      return socket.close();
    }

    if (player.status === "afk") player.status = "playing";

    if (player.bricks === 0) return player.close("no bricks");

    if (offsets.some(([xd, yd]) => player.grid[y + yd]?.[x + xd] !== false)) {
      return player.close(`invalid placement (grid=(${x},${y}))`);
    }

    const path = findPath(player.grid, player.checkpoint);
    if (!path) return player.close("invalid placement (path)");

    offsets.forEach(([xd, yd]) => player.grid[y + yd][x + xd] = true);

    player.blocks.push({ x, y, player: true });
    player.bricks--;
  },
  transition: (socket: WebSocket, { x, y }: TransitionBlockMessage) => {
    const player = Player.from(socket);

    if (!player) {
      console.log(new Date(), "Closing missing player");
      return socket.close();
    }

    const block = player.blocks.find((b) => b.x === x && b.y === y);

    if (!block) return player.close("invalid block");

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
  list: async (socket: WebSocket) => {
    const player = Player.from(socket);

    if (!player) {
      console.log(new Date(), "Closing missing player");
      return socket.close();
    }

    player.send({ kind: "list", items: await listDailies(player.id) });
  },
  play: (socket: WebSocket, { iteration }: PlayMessage) => {
    const player = Player.from(socket);

    if (!player) {
      console.log(new Date(), "Closing missing player");
      return socket.close();
    }

    if (player.status !== "afk" && player.status !== "init") return;

    player.play(iteration);
  },
  ready: (socket: WebSocket) => {
    const player = Player.from(socket);

    if (!player) {
      console.log(new Date(), "Closing missing player");
      return socket.close();
    }

    if (player.status === "afk" || player.status === "playing") {
      player.startRunner();
    }
  },
};
