import "../common/types.d.ts";
import "./util/gen.ts";
import "./util/rateDailies.ts";
import { router } from "./router.ts";
import { log } from "./util/logging.ts";

// On Deno Deploy the listening port is managed by the platform; `PORT` is only
// used for local development.
const port = Number(Deno.env.get("PORT")) || undefined;

Deno.serve({
  port,
  onListen: ({ port }) => log.info("Listening on", port),
}, (req) => router.route(req));
