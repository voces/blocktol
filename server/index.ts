import "../common/types.d.ts";
import "./util/gen.ts";
import "./util/rateDailies.ts";
import { migrate } from "./db/migrate.ts";
import { withSecurityHeaders } from "./middleware/securityHeaders.ts";
import { router } from "./router.ts";
import { alertAdmin } from "./util/adminAlert.ts";
import { errText, log } from "./util/logging.ts";

// Bind the port FIRST, then migrate. The cohost fronts a single upstream
// (nginx → 127.0.0.1:3040), so any window with the port unbound is a hard 502.
// The `ready` gate keeps this safe: a request that arrives mid-migration awaits
// it rather than running against a schema the code predates. With no pending
// migration `ready` resolves at once; otherwise requests are held, not dropped.
//
// A lease lock elects one migrator across processes (see migrate.ts); the rest
// wait (capped) for it to record the target version. A failure is caught, not
// fatal, so the process never crash-loops: it is logged, the gate resolves
// anyway, and the next boot retries once the lease expires.
const ready = migrate().catch((err) => {
  log.error("startup migration failed", { error: errText(err) });
  // This process keeps serving, possibly against a schema the code predates.
  // Operator-actionable, so alert rather than rely on the localhost-only log
  // UI.
  alertAdmin(`startup migration failed: ${errText(err)}`);
});

// `PORT` is set locally and on the cohost (nginx's upstream, see deploy/); a
// Deno Deploy preview leaves it unset and the platform picks the port.
const port = Number(Deno.env.get("PORT")) || undefined;

Deno.serve({
  port,
  onListen: ({ port }) => log.info("listening", { port }),
}, async (req) => {
  await ready;
  return withSecurityHeaders(await router.route(req));
});
