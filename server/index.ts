import "../common/types.d.ts";
import "./util/gen.ts";
import "./util/rateDailies.ts";
import { migrate } from "./db/migrate.ts";
import { router } from "./router.ts";
import { log } from "./util/logging.ts";

// Bind the port FIRST, then migrate — so a redeploy's fresh process starts
// accepting connections immediately. The cohost fronts a single upstream
// (nginx → 127.0.0.1:3040), so any window where the port is unbound is a hard
// 502; binding before the migration DB round-trip cuts that window to the bare
// process spin-up. Correctness is preserved by the `ready` gate below: a request
// that arrives before migrations finish AWAITS them rather than being served
// against a schema the code predates — the old serve-after-migrate invariant,
// minus the downtime. Most deploys carry no pending migration, so `ready`
// resolves almost at once; a migration deploy briefly HOLDS requests (a small
// latency blip) instead of dropping them.
//
// A lease lock elects a single migrator across isolates (see migrate.ts); the
// rest return at once. Caught rather than fatal: a failure here shouldn't
// crash-loop the isolate — it's logged, and the next boot retries once the lease
// expires. The gate resolves either way, so a migration hiccup degrades to
// serving (exactly as the old catch did) rather than wedging the process.
const ready = migrate().catch((err) => {
  log.error("startup migration failed", err);
});

// On Deno Deploy the listening port is managed by the platform; `PORT` is only
// used for local development.
const port = Number(Deno.env.get("PORT")) || undefined;

Deno.serve({
  port,
  onListen: ({ port }) => log.info("Listening on", port),
}, async (req) => {
  await ready;
  return router.route(req);
});
