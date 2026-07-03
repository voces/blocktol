import { Env, env } from "./env.ts";
import { log } from "./logging.ts";

// NOTE: this module is not currently imported anywhere (the metric/event call
// sites were never wired up). It is kept and made platform-correct so it can be
// dropped in if/when metrics are wanted again.
//
// The new Deno Deploy runs ephemeral, request-scoped isolates, so the previous
// design (buffer in memory, flush on a `setInterval`) would silently drop data
// whenever an isolate was evicted. Instead we POST each metric/event as it
// happens (fire-and-forget).

const apiKey = Deno.env.get("NEW_RELIC_API_KEY");

type CountMetric = "blocktol.login";

type EventType = "blocktol_run" | "blocktol_login";

const post = (url: string, body: unknown) => {
  if (!apiKey) return;
  fetch(url, {
    method: "POST",
    headers: { "Api-Key": apiKey },
    body: JSON.stringify(body),
  }).catch((err) => log.error("metrics post failed", err));
};

export const incrementMetric = (name: CountMetric, value = 1) =>
  post("https://metric-api.newrelic.com/metric/v1", [{
    metrics: [{
      name,
      type: "count",
      value,
      timestamp: Date.now(),
      "interval.ms": 0,
      attributes: { env },
    }],
  }]);

const postEvents = <T extends { eventType: EventType; env: Env }>(
  event: T | T[],
) =>
  post(
    "https://insights-collector.newrelic.com/v1/accounts/3717954/events",
    Array.isArray(event) ? event : [event],
  );

export const loginEvent = (userId: string) =>
  postEvents({ eventType: "blocktol_login", env, userId });

export const runEvents = (
  events: {
    userId: string;
    iteration: number;
    duration: number;
  }[],
) => postEvents(events.map((e) => ({ eventType: "blocktol_run", env, ...e })));
