import { ServerMessage } from "./ServerMessage.ts";
import { trackLeadership } from "./trackLeadership.ts";
import { log } from "./util/logging.ts";

const channel = new BroadcastChannel("global");
trackLeadership(channel, () => {
  log.info("Elected leader");
});

export const broadcast = (message: ServerMessage) => {
  channel.postMessage(message);
};
