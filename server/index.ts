import { ConnInfo, serve } from "https://deno.land/std@0.165.0/http/server.ts";
import { serveFile } from "https://deno.land/std@0.165.0/http/file_server.ts";
import { join, normalize } from "https://deno.land/std@0.165.0/path/posix.ts";
import { isMessage } from "../common/clientToServerMessage.ts";
import { clientHandlers } from "./clientHandlers.ts";
import "./channel.ts";
import { Player } from "./Player.ts";
import { LRUMap } from "./util/LRUMap.ts";
import "./util/gen.ts";

const port = parseInt(Deno.env.get("PORT") ?? "NaN") || 3000;

console.log(new Date(), "Listening on", port);

const hostLru = new LRUMap<string, [time: number, value: number]>();
const HOST_SPAM_MAX = 20; // max tokens allowed
const HOST_SPAM_FREQ = 6; // tokens per second
const isSpamming = (connInfo: ConnInfo, tokens = 1) => {
  if (connInfo.remoteAddr.transport !== "tcp") return false;

  const value = hostLru.getAndSet(
    connInfo.remoteAddr.hostname,
    (v) => {
      if (!v) return [Date.now(), tokens];
      const now = Date.now();
      return [
        now,
        Math.max(v[1] - HOST_SPAM_FREQ * (now - v[0]) / 1000, 0) + tokens,
      ];
    },
  )[1];

  return value > HOST_SPAM_MAX;
};

serve((req, connInfo) => {
  const upgrade = req.headers.get("upgrade") || "";
  if (upgrade.toLowerCase() !== "websocket") {
    let pathname = normalize(decodeURI(new URL(req.url).pathname));
    if (pathname.match(/^\/[a-z0-9\-]+$/)) pathname = "/";
    const path = join(Deno.cwd(), "public", pathname);

    return Deno.stat(path).then((fileInfo) =>
      fileInfo.isDirectory
        ? serveFile(req, join(path, "index.html"))
        : serveFile(req, path)
    ).catch((err) => {
      console.error(err);
      return new Response(undefined, {
        status: 302,
        headers: { "Location": "/" },
      });
    });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);

  if (isSpamming(connInfo, 5)) setTimeout(() => socket.close());

  socket.onopen = () =>
    console.log(
      new Date(),
      "Socket opened",
      connInfo.remoteAddr.transport === "tcp"
        ? connInfo.remoteAddr.hostname
        : connInfo,
    );

  socket.onmessage = (e) => {
    if (isSpamming(connInfo)) return socket.close();

    try {
      const message = JSON.parse(e.data);
      if (isMessage(message) && message.kind in clientHandlers) {
        // deno-lint-ignore no-explicit-any
        clientHandlers[message.kind](socket, message as any);
      } else {
        console.log(new Date(), "Closing bad message", message);
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

  socket.onclose = () => {
    const player = Player.from(socket);
    if (player) player.close("socket closed");
    else console.log(new Date(), "Socket closed");
  };

  return response;
}, { port });
