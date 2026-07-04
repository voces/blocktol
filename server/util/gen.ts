import { getDailyIteration } from "../db/iteration.ts";
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
    await ensureIteration(day);
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
Deno.cron("ensure-iterations", "0 * * * *", () => ensureIterations(14));
