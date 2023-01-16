import "../common/types.d.ts";
import { ConnInfo, serve } from "std/http/server.ts";
import "./channel.ts";
import { LRUMap } from "./util/LRUMap.ts";
import "./util/gen.ts";
import { router } from "./router.ts";

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
    return router.route(req);

    // let pathname = normalize(decodeURI(new URL(req.url).pathname));
    // if (pathname.match(/^\/[a-z0-9\-]+$/)) pathname = "/";
    // const path = join(Deno.cwd(), "public", pathname);

    // return Deno.stat(path).then((fileInfo) =>
    //   fileInfo.isDirectory
    //     ? serveFile(req, join(path, "index.html"))
    //     : serveFile(req, path)
    // ).catch((err) => {
    //   console.error(err);
    //   return new Response(undefined, {
    //     status: 302,
    //     headers: { "Location": "/" },
    //   });
    // });
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

  socket.onerror = (e) =>
    // deno-lint-ignore no-explicit-any
    console.log(new Date(), "Socket errored:", (e as any).message);

  socket.onclose = () => {
    // const player = Player.from(socket);
    // if (player) player.close("socket closed");
    // else console.log(new Date(), "Socket closed");
  };

  return response;
}, { port });
