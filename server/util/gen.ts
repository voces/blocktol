import {
  getDailyIteration,
  getStaleUnratedIterations,
} from "../db/iteration.ts";
import { alertAdmin } from "./adminAlert.ts";
import { errText, log } from "./logging.ts";
import { newIteration } from "./newIteration.ts";
import { pruneStaleData } from "./retention.ts";

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
  // Through tomorrow (UTC): timezones ahead of UTC reach a new local day before
  // UTC does, so tomorrow's puzzle must already exist.
  while (day < Date.now() + 2 * ONE_DAY) {
    // A DB error on one day must not skip the later days, tomorrow's included.
    // Log and move on; the next hourly run retries (ensureIteration is
    // idempotent).
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
  // A day without an iteration has no daily at all, so an operator must see it.
  // Alert ONCE per run, not per day (a DB outage fails every day in the
  // window). The hourly retry heals blips: a repeat alert means still broken.
  if (failures.length) {
    const shown = failures.slice(0, 3).join(", ");
    alertAdmin(
      `ensure-iterations: ${failures.length} day(s) failed to generate (${shown}${
        failures.length > 3 ? ", …" : ""
      }) — a day with no iteration has no daily`,
    );
  }
};

// A day becomes ratable 37h after its UTC start (getUnratedClosedIterations)
// and rate-dailies retries it hourly; one still unrated this many hours past
// that means rating has stopped.
const STALE_AFTER_CLOSE_HOURS = 6;
const CLOSE_HOURS = 37;

// The watchdog for rate-dailies. It runs from THIS cron so a dead or
// unregistered rating cron is still noticed; otherwise an unrated day silently
// never sends its ELO or daily-final notifications. At most one alert per run,
// and a failed probe is only logged so it can't block generation.
const checkRatingLiveness = async () => {
  try {
    const { count, oldest } = await getStaleUnratedIterations(
      CLOSE_HOURS + STALE_AFTER_CLOSE_HOURS,
    );
    if (count === 0) return;
    log.warn("closed dailies left unrated", { count, oldest });
    alertAdmin(
      `rate-dailies looks stalled: ${count} closed day(s) still unrated more ` +
        `than ${STALE_AFTER_CLOSE_HOURS}h after close (oldest ${
          String(oldest).slice(0, 10)
        }) — no ELO or daily-final notifications until it runs`,
    );
  } catch (err) {
    log.error("rating liveness check failed", { error: errText(err) });
  }
};

// Bulk daily generation. `Deno.cron` never overlaps itself, so this is a single
// writer for the whole 33-day window (31 back, through tomorrow). Hourly is
// enough: the window reaches tomorrow, so each day exists ~a day before any
// timezone needs it. It also seeds new envs and heals gaps. Idempotent; must be
// registered before `Deno.serve`.
//
// It is NOT the only writer: the per-request backfill (`ensureDailyIterationId`
// in util/newIteration.ts) generates a missing day on demand, because Deno
// Deploy previews don't run `Deno.cron`. The two can race (check-then-create),
// but `iteration.created` is UNIQUE (migration v14), so the loser's INSERT is
// rejected: the DB is the mutex.
//
// DISABLE_CRONS skips registration so a second instance on this DB doesn't
// duplicate the work.
//
// Each run ends with the rating-liveness check and the retention sweep
// (util/retention.ts).
if (!Deno.env.get("DISABLE_CRONS")) {
  Deno.cron("ensure-iterations", "0 * * * *", async () => {
    await ensureIterations(31);
    await checkRatingLiveness();
    await pruneStaleData();
  });
}
