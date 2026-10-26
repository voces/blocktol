import { log } from "./logging.ts";

// Background jobs (the crons) a shutdown lets finish. A restart that kills
// rate-dailies between claiming a day and announcing it loses that day's
// notifications and Discord posts for good: the day is already `rated`, so no
// later run retries them.
const running = new Set<Promise<void>>();
let stopping = false;

// Wrap a cron body so shutdown can wait for it, and so none starts once a
// shutdown has begun (the next process runs it instead).
export const tracked = (name: string, fn: () => Promise<void>) => async () => {
  if (stopping) {
    log.info("job skipped: shutting down", { job: name });
    return;
  }
  const job = fn();
  running.add(job);
  try {
    await job;
  } finally {
    running.delete(job);
  }
};

// Stop new jobs and wait up to `maxMs` for running ones.
export const drainJobs = async (maxMs: number) => {
  stopping = true;
  if (running.size === 0) return;
  log.info("waiting for jobs", { count: running.size });
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.allSettled(running),
    new Promise((resolve) => timer = setTimeout(resolve, maxMs)),
  ]);
  clearTimeout(timer);
};
