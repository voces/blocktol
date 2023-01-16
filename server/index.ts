import "../common/types.d.ts";
import { serve } from "std/http/server.ts";
import "./channel.ts";
import "./util/gen.ts";
import { router } from "./router.ts";
import { log } from "./util/logging.ts";

const port = parseInt(Deno.env.get("PORT") ?? "NaN") || 3000;

serve((req) => router.route(req), {
  port,
  onListen: ({ port }) => log.info("Listening on", port),
});
