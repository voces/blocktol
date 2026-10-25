import { trace } from "@opentelemetry/api";
import { SHA } from "../../common/version.ts";
import { log } from "../util/logging.ts";
import type { Handler } from "../util/Router.ts";
import { logMap, routeOf } from "./beginLogger.ts";

// The trace id OTel's no-op span reports when tracing is off (every instance
// but the EC2 one); nothing to correlate, so it isn't stamped.
const INVALID_TRACE_ID = "00000000000000000000000000000000";

const sizes = ["B", "KB", "MB", "GB", "TB"];

const prettySize = (size: number) => {
  if (Number.isNaN(size)) return "";

  let exp = 0;
  while (size >= 1024 && exp < sizes.length) {
    size /= 1024;
    exp++;
  }

  return Math.round(size) + sizes[exp];
};

export const endLogger: Handler = (req, _, prev) => {
  const data = logMap.get(req);

  // Stamp response headers. Guarded: some responses (e.g. static assets) have
  // immutable headers, where set() throws.
  //   - x-blocktol-server-sha: this process's build, so a running client can
  //     see it is older than the deploy answering and reload (api.ts →
  //     store/version.ts). Sent on every response; the client reads it off API
  //     responses only.
  //   - x-blocktol-trace-id: the request span's trace id, to pull the trace
  //     (and, via `trace_id`, the logs) from VictoriaTraces. Absent when
  //     tracing is off.
  if (prev) {
    try {
      prev.headers.set("x-blocktol-server-sha", SHA);
      const traceId = trace.getActiveSpan()?.spanContext().traceId;
      if (traceId && traceId !== INVALID_TRACE_ID) {
        prev.headers.set("x-blocktol-trace-id", traceId);
      }
    } catch { /* immutable headers — skip */ }
  }

  const length = prev?.headers.get("content-length");

  log.info(req, "request finish", {
    method: req.method,
    status: prev?.status,
    route: routeOf(req),
    // Numeric so VictoriaLogs can aggregate it.
    ms: data?.start ? Date.now() - data.start : undefined,
    size: typeof length === "string" ? prettySize(parseInt(length)) : undefined,
  });

  return prev;
};
