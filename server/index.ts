import "../common/types.d.ts";
import "./util/gen.ts";
import "./util/rateDailies.ts";
import { migrate } from "./db/migrate.ts";
import { router } from "./router.ts";
import { log } from "./util/logging.ts";

// Apply any pending schema migrations before serving, so freshly-deployed code
// never handles a request against a schema it predates. A lease lock elects a
// single migrator across isolates (see migrate.ts); the rest return at once.
// Caught rather than fatal: a failure here shouldn't crash-loop the isolate —
// it's logged, and the next boot retries once the lease expires.
try {
  await migrate();
} catch (err) {
  log.error("startup migration failed", err);
}

// On Deno Deploy the listening port is managed by the platform; `PORT` is only
// used for local development.
const port = Number(Deno.env.get("PORT")) || undefined;

Deno.serve({
  port,
  onListen: ({ port }) => log.info("Listening on", port),
}, (req) => router.route(req));
