import { game } from "./Game.ts";
import {
  RunBeatMessage,
  ServerMessage,
  StartMessage,
  StartRunMessage,
} from "./ServerMessage.ts";
import { isLeader, trackLeadership } from "./trackLeadership.ts";

const channel = new BroadcastChannel("global");
trackLeadership(channel, () => {
  console.log(new Date(), "Elected leader");
  game.start();
});

export const broadcast = (message: ServerMessage) => {
  channel.postMessage(message);
};

const handlers = {
  start: (message: StartMessage) => game.startFromState(message),
  startRun: (message: StartRunMessage) =>
    game.startRunnersFromState(message.max, message.times),
  runBeat: (message: RunBeatMessage) => isLeader() && game.runBeat(message.max),
};

channel.addEventListener("message", (e) => {
  const message: ServerMessage = e.data;

  (handlers as Record<string, undefined | ((message: unknown) => void)>)
    [message.kind]?.(
      message,
    );
});
