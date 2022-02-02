import { game } from "./Game.ts";
import { ServerMessage, StartMessage } from "./ServerMessage.ts";
import { trackLeadership } from "./trackLeadership.ts";

const channel = new BroadcastChannel("global");
trackLeadership(channel, () => {
  console.log(new Date(), "Elected leader");
  game.start();
});

export const broadcast = (message: ServerMessage) => {
  channel.postMessage(message);
};

const handlers = {
  start: (message: StartMessage) => game.broadcast(message),
};

channel.addEventListener("message", (e) => {
  const message: ServerMessage = e.data;

  // deno-lint-ignore no-explicit-any
  (handlers as any)[message.kind](message);
});
