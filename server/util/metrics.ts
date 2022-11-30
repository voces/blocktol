import { Env, env } from "./env.ts";

const apiKey = Deno.env.get("NEW_RELIC_API_KEY");

if (!apiKey) throw new Error("NEW_RELIC_API_KEY unset");

type CountMetric = "blocktol.login";

type EventType = "blocktol_run" | "blocktol_login";

const countMetrics = new Map<CountMetric, number>();
let intervalStart = Date.now();

const events: { eventType: EventType }[] = [];

export const incrementMetric = (name: CountMetric) => {
  console.log("increment", name);
  countMetrics.set(name, countMetrics.get(name) ?? 0 + 1);
};

setInterval(() => {
  const now = Date.now();
  const start = intervalStart;
  intervalStart = now;

  if (countMetrics.size > 0) {
    fetch("https://metric-api.newrelic.com/metric/v1", {
      method: "POST",
      headers: { "Api-Key": apiKey },
      body: JSON.stringify([{
        metrics: Array.from(countMetrics.entries()).map(([name, value]) => ({
          name,
          type: "count",
          value,
          timestamp: start,
          "interval.ms": now - start,
          attributes: { env },
        })),
      }]),
    });

    countMetrics.clear();
  }

  if (events.length) {
    fetch(
      "https://insights-collector.newrelic.com/v1/accounts/3717954/events",
      {
        method: "POST",
        headers: { "Api-Key": apiKey },
        body: JSON.stringify(events),
      },
    );

    events.splice(0);
  }
}, 15_000);

const postEvents = <T extends { eventType: EventType; env: Env }>(
  event: T | T[],
) => {
  if (Array.isArray(event)) events.push(...event);
  else events.push(event);
};

export const loginEvent = (userId: string) =>
  postEvents({ eventType: "blocktol_login", env, userId });

export const runEvents = (
  events: {
    userId: string;
    iteration: number;
    duration: number;
    percentile: number;
  }[],
) => postEvents(events.map((e) => ({ eventType: "blocktol_run", env, ...e })));
