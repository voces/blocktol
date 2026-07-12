import { getDailyIteration } from "../db/iteration.ts";
import { log } from "./logging.ts";
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
      log.error(
        "failed to ensure iteration for",
        new Date(day).toDateString(),
        err,
      );
    }
    day += ONE_DAY;
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
