// Traces and logs to the box's VictoriaTraces / VictoriaLogs over OTLP
// (http/protobuf), configured by the standard OTEL_* env in the unit's .env:
// OTEL_SERVICE_NAME, OTEL_EXPORTER_OTLP_TRACES_ENDPOINT and
// OTEL_EXPORTER_OTLP_LOGS_ENDPOINT. Without a traces endpoint (a local run,
// tests) nothing starts and @opentelemetry/api stays a no-op. Imported first by
// server/index.ts, so the providers exist before any span or log.
//
// Spans: each request (util/requestSpan.ts), each cron run (util/cron.ts), each
// DB call (db/trace.ts), and each outbound fetch (undici's diagnostics
// channels, so no module patching). Logs: util/logging.ts emits every line as a
// record, which joins the active span's trace.

import { context, propagation, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import {
  defaultResource,
  detectResources,
  envDetector,
} from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";
import { BatchSpanProcessor, TracerProvider } from "@opentelemetry/sdk-trace";
import process from "node:process";

let shutdown = (): Promise<unknown> => Promise.resolve();

if (process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) {
  const resource = defaultResource().merge(
    detectResources({ detectors: [envDetector] }),
  );

  const tracerProvider = new TracerProvider({
    resource,
    spanProcessors: [
      new BatchSpanProcessor({ exporter: new OTLPTraceExporter() }),
    ],
  });
  context.setGlobalContextManager(
    new AsyncLocalStorageContextManager().enable(),
  );
  // traceparent in: nginx starts the trace (deploy/blocktol-trace.conf), and
  // each request span continues it.
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  trace.setGlobalTracerProvider(tracerProvider);

  const loggerProvider = new LoggerProvider({
    resource,
    processors: [
      new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() }),
    ],
  });
  logs.setGlobalLoggerProvider(loggerProvider);

  registerInstrumentations({
    tracerProvider,
    instrumentations: [
      new UndiciInstrumentation({
        // An outbound url can be a credential: a Discord webhook's path holds
        // its token, a push endpoint is a capability url. Keep the origin.
        startSpanHook: (request) => ({
          "url.full": request.origin,
          "url.path": "",
          "url.query": "",
        }),
      }),
    ],
  });

  shutdown = () =>
    Promise.allSettled([tracerProvider.shutdown(), loggerProvider.shutdown()]);
}

// Flush what is buffered, at most `maxMs`: the exit path (server/index.ts) runs
// it last, so the shutdown's own spans and logs aren't lost.
export const flushTelemetry = async (maxMs: number): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    shutdown(),
    new Promise((resolve) => timer = setTimeout(resolve, maxMs)),
  ]);
  clearTimeout(timer);
};
