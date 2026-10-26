import { test } from "node:test";
import { assert, assertEquals } from "@std/assert";
import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from "@opentelemetry/sdk-trace";
import { log } from "./logging.ts";
import { traced } from "./requestSpan.ts";

// The providers server/otel.ts registers, exporting to memory. Registered once
// for the file: the module-level tracers are proxies bound to the first
// registration, so tearing it down between tests would orphan them.
const spans = new InMemorySpanExporter();
const records = new InMemoryLogRecordExporter();
context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
propagation.setGlobalPropagator(new W3CTraceContextPropagator());
trace.setGlobalTracerProvider(
  new TracerProvider({
    spanProcessors: [new SimpleSpanProcessor({ exporter: spans })],
  }),
);
logs.setGlobalLoggerProvider(
  new LoggerProvider({
    processors: [new SimpleLogRecordProcessor({ exporter: records })],
  }),
);

const withTelemetry = async (
  fn: (
    spans: InMemorySpanExporter,
    records: InMemoryLogRecordExporter,
  ) => Promise<void>,
) => {
  spans.reset();
  records.reset();
  await fn(spans, records);
};

const NGINX_TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const req = (path: string, headers: Record<string, string> = {}) =>
  new Request("http://x.test" + path, { headers });

test("traced: a server span that continues nginx's traceparent", async () => {
  await withTelemetry(async (spans) => {
    let activeTrace: string | undefined;
    const res = await traced(() => {
      activeTrace = trace.getActiveSpan()?.spanContext().traceId;
      return Promise.resolve(new Response("ok"));
    })(req("/robots.txt?x=1", {
      traceparent: `00-${NGINX_TRACE}-00f067aa0ba902b7-01`,
      "user-agent": "probe",
    }));
    assertEquals(res.status, 200);
    const [span] = spans.getFinishedSpans();
    assert(span);
    assertEquals(span.name, "GET");
    assertEquals(span.kind, SpanKind.SERVER);
    assertEquals(span.spanContext().traceId, NGINX_TRACE);
    assertEquals(activeTrace, NGINX_TRACE, "active inside the handler");
    assertEquals(span.parentSpanContext?.spanId, "00f067aa0ba902b7");
    assertEquals(span.attributes["url.full"], "http://x.test/robots.txt?x=1");
    assertEquals(span.attributes["url.path"], "/robots.txt");
    assertEquals(span.attributes["http.response.status_code"], 200);
    assertEquals(span.attributes["user_agent.original"], "probe");
    assertEquals(span.status.code, SpanStatusCode.UNSET);
  });
});

test("traced: a legacy sign-in link's credential never reaches the span", async () => {
  await withTelemetry(async (spans) => {
    await traced(() => Promise.resolve(new Response(null, { status: 302 })))(
      req("/l/SECRET-ID?next=1"),
    );
    const [span] = spans.getFinishedSpans();
    assertEquals(span?.attributes["url.path"], "/l/:id");
    assertEquals(span?.attributes["url.full"], "http://x.test/l/:id");
    assert(!JSON.stringify(span?.attributes).includes("SECRET"));
  });
});

test("traced: a 5xx or a throw marks the span errored", async () => {
  await withTelemetry(async (spans) => {
    await traced(() => Promise.resolve(new Response(null, { status: 503 })))(
      req("/health"),
    );
    let thrown = false;
    try {
      await traced(() => Promise.reject(new Error("boom")))(req("/x"));
    } catch {
      thrown = true;
    }
    assert(thrown, "the error still propagates");
    const [unavailable, failed] = spans.getFinishedSpans();
    assertEquals(unavailable?.status.code, SpanStatusCode.ERROR);
    assertEquals(failed?.status.code, SpanStatusCode.ERROR);
    assertEquals(failed?.events[0]?.name, "exception");
  });
});

test("a log line is a record in the active request's trace", async () => {
  await withTelemetry(async (spans, records) => {
    await traced(() => {
      log.warn("inside", { n: 1 });
      return Promise.resolve(new Response("ok"));
    })(req("/"));
    const [record] = records.getFinishedLogRecords();
    assertEquals(record?.body, "level=warn msg=inside n=1");
    assertEquals(record?.severityText, "WARN");
    assertEquals(
      record?.spanContext?.traceId,
      spans.getFinishedSpans()[0]?.spanContext().traceId,
    );
  });
});
