import { hasTodaysIteration } from "../db/iteration.ts";
import { Handler } from "../util/Router.ts";

// `GET /health` for an external uptime monitor. One cheap query proves the
// app, the database and puzzle generation are all working: 200 "ok", or 503
// with a short reason. Says nothing else, and needs no id.
export const healthCheck =
  (check: () => Promise<boolean>): Handler => async () => {
    let status = 200;
    let body = "ok";
    try {
      if (!(await check())) [status, body] = [503, "no puzzle for today"];
    } catch {
      [status, body] = [503, "db unreachable"];
    }
    return new Response(body + "\n", {
      status,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  };

export const health = healthCheck(hasTodaysIteration);
