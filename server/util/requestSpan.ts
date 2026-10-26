import {
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import { redactPath } from "../middleware/beginLogger.ts";

const tracer = trace.getTracer("blocktol-http");

const headerGetter = {
  keys: (h: Headers) => [...h.keys()],
  get: (h: Headers, key: string) => h.get(key) ?? undefined,
};

// Run one request inside a server span named by its method, continuing the
// trace an incoming `traceparent` names (nginx starts one per request,
// deploy/blocktol-trace.conf). The span is active for the whole handler, so
// endLogger's `x-blocktol-trace-id`, `user.hash` and every log line join it.
// The path is redacted (`redactPath`): a legacy sign-in link's path is the
// bearer credential. A 5xx or a throw marks the span errored.
export const traced = (
  handler: (req: Request) => Promise<Response>,
) =>
(req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const path = redactPath(url.pathname);
  const parent = propagation.extract(ROOT_CONTEXT, req.headers, headerGetter);
  return tracer.startActiveSpan(
    req.method,
    {
      kind: SpanKind.SERVER,
      attributes: {
        "http.request.method": req.method,
        "url.scheme": url.protocol.replace(":", ""),
        "url.path": path,
        // The query rides only on a non-credential path: a redacted path
        // drops what follows it.
        "url.full": url.origin +
          (path === url.pathname ? path + url.search : path),
        "server.address": url.hostname,
        "user_agent.original": req.headers.get("user-agent") ?? undefined,
      },
    },
    parent,
    async (span) => {
      try {
        const res = await handler(req);
        span.setAttribute("http.response.status_code", res.status);
        if (res.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
        return res;
      } catch (err) {
        span.recordException(err instanceof Error ? err : String(err));
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw err;
      } finally {
        span.end();
      }
    },
  );
};
