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
  while (day < Date.now() + ONE_DAY) {
    await ensureIteration(day);
    day += ONE_DAY;
  }
};

// Backfill recent history on cold start (idempotent: each day is only created
// if it does not already exist).
ensureIterations(14);

// The new Deno Deploy runs ephemeral, request-scoped isolates, so long-lived
// `setInterval` timers are not reliable. `Deno.cron` is scheduled by the
// platform independently of traffic and is the supported way to run periodic
// work. Registered at module top level (before `Deno.serve`) as required.
Deno.cron("ensure-iterations", "* * * * *", () => ensureIterations(1));
