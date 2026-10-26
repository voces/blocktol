import { Cron } from "croner";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { errText, log } from "./logging.ts";
import { tracked } from "./shutdown.ts";

const tracer = trace.getTracer("blocktol");

// Schedule a background job. Every run is on UTC, the clock the day logic
// uses, whatever the host's zone; and a job never overlaps itself: a run still
// going when the next is due skips that one (croner's `protect`). Each run is a
// `cron` span (`cron.name`, `cron.schedule`) that the job's logs join, and
// shutdown waits for it (`tracked`). A throw is logged and recorded on the
// span, and the schedule carries on. `unref`: the server keeps the process up,
// a schedule alone must not.
export const schedule = (
  name: string,
  pattern: string,
  fn: () => Promise<void>,
): Cron => {
  const run = tracked(name, fn);
  return new Cron(
    pattern,
    { name, timezone: "UTC", protect: true, unref: true },
    () =>
      tracer.startActiveSpan(
        "cron",
        { attributes: { "cron.name": name, "cron.schedule": pattern } },
        async (span) => {
          try {
            await run();
          } catch (err) {
            log.error("cron job failed", { job: name, error: errText(err) });
            span.recordException(err instanceof Error ? err : String(err));
            span.setStatus({ code: SpanStatusCode.ERROR });
          } finally {
            span.end();
          }
        },
      ),
  );
};
