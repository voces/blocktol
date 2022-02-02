import { serve } from "std/http/server.ts";
import { isMessage } from "../common/clientToServerMessage.ts";
import { clientHandlers } from "./clientHandlers.ts";
import { game } from "./Game.ts";
import { trackLeadership } from "./trackLeadership.ts";

const channel = new BroadcastChannel("global");
trackLeadership(channel, () => {
  game.start();
});

// const serverHandlers = {
//   newNode: (_message: NewNodeMessage) => {
//     if (rootStatus === "root") channel.postMessage({ kind: "root" });
//   },
//   root: (_message: RootIdentifyMessage) => {
//     rootStatus = "not-root";
//   },
// };

// channel.addEventListener("message", (e) => {
//   const message = e.data as ServerMessage;
//   serverHandlers[message.kind](message as any);
// });

console.log(new Date(), "Listening on", 3000);

serve((req) => {
  const upgrade = req.headers.get("upgrade") || "";
  if (upgrade.toLowerCase() !== "websocket") {
    return new Response("websocket only server");
  }
  const { socket, response } = Deno.upgradeWebSocket(req);

  socket.onopen = () => console.log(new Date(), "Socket opened");
  socket.onmessage = (e) => {
    try {
      const message = JSON.parse(e.data);
      if (isMessage(message)) {
        // deno-lint-ignore no-explicit-any
        clientHandlers[message.kind](socket, message as any);
      } else socket.close();
    } catch {
      socket.close();
    }
  };
  socket.onerror = (e) =>
    // deno-lint-ignore no-explicit-any
    console.log(new Date(), "Socket errored:", (e as any).message);
  socket.onclose = () => console.log(new Date(), "Socket closed");

  return response;
}, { port: 3000 });
