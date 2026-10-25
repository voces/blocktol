import "../common/types.d.ts";
import "./util/gen.ts";
import "./util/rateDailies.ts";
import { migrate } from "./db/migrate.ts";
import { withSecurityHeaders } from "./middleware/securityHeaders.ts";
import { router } from "./router.ts";
import { alertAdmin } from "./util/adminAlert.ts";
import { errText, log } from "./util/logging.ts";
import { drainJobs } from "./util/shutdown.ts";

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

// `PORT` is set on the box (nginx's upstream, see deploy/) and usually locally;
// unset, Deno.serve picks its default. With a PORT, listen on loopback only:
// nginx is the one way in, so TLS and its rate limits can't be bypassed if a
// firewall rule ever opens the port.
const port = Number(Deno.env.get("PORT")) || undefined;

const server = Deno.serve({
  ...(port ? { port, hostname: "127.0.0.1" } : {}),
  onListen: ({ port }) => log.info("listening", { port }),
}, async (req) => {
  await ready;
  // HEAD is GET without the body. Uptime monitors and link checkers send it,
  // and the router only registers GET, so route it as one and drop the body.
  if (req.method === "HEAD") {
    const res = await router.route(
      new Request(req.url, { method: "GET", headers: req.headers }),
    );
    await res.body?.cancel();
    return withSecurityHeaders(new Response(null, res));
  }
  return withSecurityHeaders(await router.route(req));
});

// Graceful stop on SIGTERM (systemd's restart on every deploy): finish
// in-flight requests and any running cron (see util/shutdown.ts) before
// exiting, rather than dropping them. Capped below the unit's TimeoutStopSec.
// Windows has no SIGTERM listener, so a local run there skips the drain.
const DRAIN_MS = 60_000;
try {
  Deno.addSignalListener("SIGTERM", async () => {
    log.info("shutting down");
    await Promise.race([
      Promise.allSettled([server.shutdown(), drainJobs(DRAIN_MS)]),
      new Promise((resolve) => setTimeout(resolve, DRAIN_MS + 5_000)),
    ]);
    Deno.exit(0);
  });
} catch { /* no signal support on this platform */ }
