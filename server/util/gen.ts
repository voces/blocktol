import { getDailyIteration } from "../db/iteration.ts";
import { alertAdmin } from "./adminAlert.ts";
import { errText, log } from "./logging.ts";
import { newIteration } from "./newIteration.ts";

const ONE_MINUTE = 1_000 * 60;
const ONE_DAY = ONE_MINUTE * 60 * 24;

const ensureIteration = async (unix: number) => {
  const date = new Date(unix);
  const iteration = await getDailyIteration(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
  );
  if (!iteration) await newIteration(date);
};

const ensureIterations = async (offsetDays: number) => {
  let day = Date.now() - offsetDays * ONE_DAY;
  const failures: string[] = [];
  // Through tomorrow (UTC): a day's iteration is keyed to the server (UTC) date,
  // but a player's daily is their *local* date, so timezones ahead of UTC reach
  // a new local day before UTC does — pre-generate tomorrow so they have it.
  while (day < Date.now() + 2 * ONE_DAY) {
    // A DB error on one day must not abort the rest of the window, or a blip on
    // an early day would skip generating every later one — including tomorrow's
    // puzzle. Log and move on; the next hourly run retries any day still missing
    // (ensureIteration is idempotent).
    try {
      await ensureIteration(day);
    } catch (err) {
      log.error("failed to ensure iteration", {
        date: new Date(day).toDateString(),
        error: errText(err),
      });
      failures.push(new Date(day).toDateString());
    }
    day += ONE_DAY;
  }
  // A day left without an iteration has no daily at all — the one generation
  // failure an operator must actually see, since the only other trace is a line
  // in the localhost-only log UI. Alert ONCE per run rather than per day (a full
  // DB outage fails every day in the window) — a no-op without the webhook. The
  // hourly retry heals transient blips, so a repeat alert means it's still broken.
  if (failures.length) {
    const shown = failures.slice(0, 3).join(", ");
    alertAdmin(
      `ensure-iterations: ${failures.length} day(s) failed to generate (${shown}${
        failures.length > 3 ? ", …" : ""
      }) — a day with no iteration has no daily`,
    );
  }
};

// Single-writer daily generation. `ensureIteration` is check-then-create (not
// atomic), so running it on multiple isolates could create duplicate iterations
// for a day. `Deno.cron` runs once per schedule, never overlapping, so it's the
// lone writer — replacing the per-isolate cold-start backfill that caused the
// race. Hourly is enough: the window reaches tomorrow, so each day is generated
// ~a day before any timezone needs it (this also seeds new envs / heals gaps).
// Idempotent; must be registered before `Deno.serve`.
//
// DISABLE_CRONS gates registration so a second instance sharing this DB (a
// staging box, or the EC2 cohost while Deno Deploy still runs the crons) doesn't
// double-generate. The write path is already race-safe, but skipping the
// duplicate work is cleaner.
if (!Deno.env.get("DISABLE_CRONS")) {
  Deno.cron("ensure-iterations", "0 * * * *", () => ensureIterations(31));
}
