// Structured logging as **logfmt**: one line of flat `key=value` pairs, so
// VictoriaLogs can pull `status`/`route`/`userHash`/… out as queryable fields (a
// `| unpack_logfmt _msg` at query time). logfmt is flat by construction — a value
// is a scalar — and that's enforced here: the field type bans nested
// objects/arrays, so a consumer is forced to flatten rather than have structure
// silently stringified into an opaque blob VL can't see. For the common "log a
// thrown value" case use `errText`; for an arbitrary `unknown` record (client
// error payloads) use `coerceFlat`.

type LogValue = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogValue>;

// Per-request context (userHash, …) merged into every log for that request. Flat,
// like everything else.
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

// Flatten a caught value to one logfmt-safe field. An Error's stack already
// includes its message; anything else stringifies. Use at the sites that log a
// thrown value: `log.error("x failed", { error: errText(err) })`.
export const errText = (err: unknown): string =>
  err instanceof Error ? (err.stack ?? err.message) : String(err);

// Coerce an arbitrary record (e.g. a client-supplied error payload, typed
// `unknown`) to flat fields — non-primitive values are stringified into a single
// value rather than flattened. The escape hatch for the few `unknown`-typed sites;
// the typed `log` API otherwise rejects nested values at compile time.
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

// logfmt value encoding: bare when safe, JSON-quoted otherwise — which also
// escapes spaces, `=`, quotes, backslashes, and newlines, so a multi-line stack
// collapses onto the one log line. null/undefined fields are dropped.
const needsQuote = (s: string) => s === "" || /[\s="\\]/.test(s);
const encode = (v: string | number | boolean): string =>
  typeof v === "string" ? (needsQuote(v) ? JSON.stringify(v) : v) : String(v);

const fieldsToLogfmt = (fields: LogFields): string =>
  Object.entries(fields)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${k}=${encode(v as string | number | boolean)}`)
    .join(" ");

type Level = "error" | "warn" | "info" | "debug";

// The full logfmt line. `level=` doubles as the field Grafana colours log rows by.
// No timestamp in the payload — Deno's OTel stamps `_time`; a second one here would
// duplicate it (the bug the Vector-shipped services hit).
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
  // The call's own fields win over the request context (userHash, …) on collision.
  const all: LogFields = req
    ? { ...getLoggingContext(req), ...fields }
    : fields;
  // The one sanctioned console call — the sink every other log flows to.
  // deno-lint-ignore no-console
  console[level](formatLogfmt(level, msg, all));
};

// `(msg, fields?)`, or `(req, msg, fields?)` to fold in the request context.
// `fields` is flat by type — nested values don't compile (flatten with errText /
// coerceFlat).
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
