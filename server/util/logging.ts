import { logs, SeverityNumber } from "@opentelemetry/api-logs";

// Structured logging as **logfmt**: one line of flat `key=value` pairs, so
// VictoriaLogs can query `status`/`route`/`userHash`/… as fields (via
// `| unpack_logfmt _msg`). The field type bans nested objects/arrays, forcing
// callers to flatten rather than get an opaque stringified blob. Use `errText`
// to log a thrown value and `coerceFlat` for an arbitrary `unknown` record
// (client error payloads).

type LogValue = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogValue>;

// Per-request context (userHash, …) merged into every log for that request.
const loggingContextMap = new WeakMap<Request, LogFields>();

export const setLoggingContext = (
  req: Request,
  context: LogFields | ((old: LogFields) => LogFields),
) => {
  loggingContextMap.set(
    req,
    typeof context === "function"
      ? context(loggingContextMap.get(req) ?? {})
      : context,
  );
};

export const getLoggingContext = (req: Request): LogFields => {
  const existing = loggingContextMap.get(req);
  if (existing) return existing;
  const fresh: LogFields = {};
  loggingContextMap.set(req, fresh);
  return fresh;
};

// Flatten a caught value to one field: an Error's stack (which includes its
// message), else its string form:
// `log.error("x failed", { error: errText(err) })`.
export const errText = (err: unknown): string =>
  err instanceof Error ? (err.stack ?? err.message) : String(err);

// Coerce an `unknown`-typed record (e.g. a client error payload) to flat
// fields; non-primitive values are stringified, not flattened.
export const coerceFlat = (obj: Record<string, unknown>): LogFields => {
  const out: LogFields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (
      v == null || typeof v === "string" || typeof v === "number" ||
      typeof v === "boolean"
    ) out[k] = v as LogValue;
    else if (v instanceof Error) out[k] = errText(v);
    else {
      try {
        out[k] = JSON.stringify(v);
      } catch {
        out[k] = String(v);
      }
    }
  }
  return out;
};

// logfmt value encoding: bare when safe, else JSON-quoted, which escapes
// spaces, `=`, quotes, backslashes and newlines so a multi-line stack stays on
// one line. null/undefined fields are dropped.
const needsQuote = (s: string) => s === "" || /[\s="\\]/.test(s);
const encode = (v: string | number | boolean): string =>
  typeof v === "string" ? (needsQuote(v) ? JSON.stringify(v) : v) : String(v);

// Keys are bare, so they are reduced to a safe charset: a space, `=` or quote
// in a client-supplied key (see reportClientError) could forge fields or
// desync the line.
const encodeKey = (k: string): string =>
  k.replace(/[^A-Za-z0-9_.\-]/g, "_") || "_";

const fieldsToLogfmt = (fields: LogFields): string =>
  Object.entries(fields)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) =>
      `${encodeKey(k)}=${encode(v as string | number | boolean)}`
    )
    .join(" ");

type Level = "error" | "warn" | "info" | "debug";

const SEVERITY: Record<Level, SeverityNumber> = {
  error: SeverityNumber.ERROR,
  warn: SeverityNumber.WARN,
  info: SeverityNumber.INFO,
  debug: SeverityNumber.DEBUG,
};

// The full logfmt line. `level=` is the field Grafana colours rows by. No
// timestamp: the log record carries one (VictoriaLogs' `_time`), and a second
// would duplicate it.
export const formatLogfmt = (
  level: string,
  msg: string,
  fields: LogFields,
): string => {
  const tail = fieldsToLogfmt(fields);
  return `level=${level} msg=${encode(msg)}${tail ? " " + tail : ""}`;
};

const emit = (
  level: Level,
  req: Request | undefined,
  msg: string,
  fields: LogFields,
) => {
  // The call's own fields win over the request context on collision.
  const all: LogFields = req
    ? { ...getLoggingContext(req), ...fields }
    : fields;
  const line = formatLogfmt(level, msg, all);
  // The one sanctioned console call; every log flows through it. stdout is
  // the journal, read on the box with journalctl.
  // deno-lint-ignore no-console
  console[level](line);
  // The same line as an OTel log record (server/otel.ts ships it to
  // VictoriaLogs as `_msg`), joining the active span's trace; a no-op with
  // telemetry off. Looked up per call: a logger taken before the provider is
  // registered would stay a no-op.
  logs.getLogger("blocktol").emit({
    severityNumber: SEVERITY[level],
    severityText: level.toUpperCase(),
    body: line,
  });
};

// `(msg, fields?)`, or `(req, msg, fields?)` to fold in the request context.
type LogFn = {
  (msg: string, fields?: LogFields): void;
  (req: Request, msg: string, fields?: LogFields): void;
};

const make = (level: Level): LogFn =>
  ((a: Request | string, b?: string | LogFields, c?: LogFields) =>
    a instanceof Request
      ? emit(level, a, b as string, c ?? {})
      : emit(level, undefined, a, (b as LogFields) ?? {})) as LogFn;

export const log = {
  error: make("error"),
  warn: make("warn"),
  info: make("info"),
  debug: make("debug"),
};
