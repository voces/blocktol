// First: the telemetry providers must exist before anything opens a span.
import { flushTelemetry } from "./otel.ts";
import "../common/types.d.ts";
import "./util/gen.ts";
import "./util/rateDailies.ts";
import { migrate } from "./db/migrate.ts";
import { withSecurityHeaders } from "./middleware/securityHeaders.ts";
import { router } from "./router.ts";
import { alertAdmin } from "./util/adminAlert.ts";
import { errText, log } from "./util/logging.ts";
import { traced } from "./util/requestSpan.ts";
import { drainJobs } from "./util/shutdown.ts";
import { serve } from "@hono/node-server";
import process from "node:process";

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
// unset, the server listens on 8000. With a PORT, listen on loopback only:
// nginx is the one way in, so TLS and its rate limits can't be bypassed if a
// firewall rule ever opens the port.
const port = Number(process.env.PORT) || undefined;

const handle = traced(async (req) => {
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

// `overrideGlobalObjects: false` keeps the platform's own Request/Response:
// the adapter otherwise swaps in lighter look-alikes for the whole process.
const server = serve(
  {
    fetch: handle,
    overrideGlobalObjects: false,
    ...(port ? { port, hostname: "127.0.0.1" } : { port: 8000 }),
  },
  (info) => log.info("listening", { port: info.port }),
);

// Graceful stop on SIGTERM (systemd's restart on every deploy): finish
// in-flight requests and any running cron (see util/shutdown.ts) before
// exiting, rather than dropping them, then flush telemetry. Capped below the
// unit's TimeoutStopSec. `close` stops accepting and ends idle keep-alive
// connections; an in-flight request still completes.
const DRAIN_MS = 60_000;
const closed = () =>
  new Promise<void>((resolve) => server.close(() => resolve()));
process.on("SIGTERM", async () => {
  log.info("shutting down");
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.allSettled([closed(), drainJobs(DRAIN_MS)]),
    new Promise((resolve) => timer = setTimeout(resolve, DRAIN_MS + 5_000)),
  ]);
  clearTimeout(timer);
  await flushTelemetry(3_000);
  process.exit(0);
});
