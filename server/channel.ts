import { ServerMessage } from "./ServerMessage.ts";
import { trackLeadership } from "./trackLeadership.ts";

const channel = new BroadcastChannel("global");
trackLeadership(channel, () => {
  console.log(new Date(), "Elected leader");
});

export const broadcast = (message: ServerMessage) => {
  channel.postMessage(message);
};
