import { trace } from "@opentelemetry/api";
import { SHA } from "../../common/version.ts";
import { log } from "../util/logging.ts";
import { Handler } from "../util/Router.ts";
import { logMap, routeOf } from "./beginLogger.ts";

// The all-zero trace id OTel's no-op span reports when tracing is off (the Deno
// Deploy instance) — nothing to correlate, so don't stamp it.
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

  // Stamp response headers on the way out. Guarded: a few responses (e.g. some
  // static assets) come back with immutable headers, where set() throws.
  //   - x-blocktol-server-sha: this process's build, so a running client can
  //     tell it's older than the deploy now answering and reload (client reads
  //     it in api.ts → store/version.ts). Every handled response carries it — the
  //     client only reads it off API responses, but a blanket header is simplest
  //     and harmless elsewhere.
  //   - x-blocktol-trace-id: the request span's trace id, so a response can be
  //     pasted straight into VictoriaTraces to pull its full trace (and, via the
  //     shared trace_id, its logs). Only on the co-located instance where tracing
  //     is on; the un-instrumented Deno Deploy process reports the invalid
  //     all-zero id and gets no header.
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
    // Numeric ms (was "12ms") so it's aggregatable in VictoriaLogs.
    ms: data?.start ? Date.now() - data.start : undefined,
    size: typeof length === "string" ? prettySize(parseInt(length)) : undefined,
  });

  return prev;
};
