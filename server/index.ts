import { serve } from "https://deno.land/std@0.119.0/http/server.ts";
import { isMessage } from "../common/clientToServerMessage.ts";
import { clientHandlers } from "./clientHandlers.ts";
import "./channel.ts";
import { serveFile } from "./serveFile.ts";

const port = parseInt(Deno.env.get("PORT") ?? "NaN") || 3000;

console.log(new Date(), "Listening on", port);

serve((req, connInfo) => {
  const upgrade = req.headers.get("upgrade") || "";
  if (upgrade.toLowerCase() !== "websocket") {
    return serveFile(req);
  }
  const { socket, response } = Deno.upgradeWebSocket(req);

  socket.onopen = () =>
    console.log(
      new Date(),
      "Socket opened",
      connInfo.remoteAddr.transport === "tcp"
        ? connInfo.remoteAddr.hostname
        : connInfo,
    );

  socket.onmessage = (e) => {
    try {
      const message = JSON.parse(e.data);
      if (isMessage(message)) {
        // deno-lint-ignore no-explicit-any
        clientHandlers[message.kind](socket, message as any);
      } else {
        console.log(new Date(), "Closing bad message");
        socket.close();
      }
    } catch (err) {
      console.error(err);
      console.log(new Date(), "Closing error");
      socket.close();
    }
  };

  socket.onerror = (e) =>
    // deno-lint-ignore no-explicit-any
    console.log(new Date(), "Socket errored:", (e as any).message);

  socket.onclose = () => console.log(new Date(), "Socket closed");

  return response;
}, { port });
