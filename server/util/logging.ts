const loggingContextMap = new WeakMap<Request, Record<string, unknown>>();

export const withLoggingContext = <T>(
  req: Request,
  context: Record<string, unknown>,
  callback: () => T,
) => {
  const hadOldContext = loggingContextMap.has(req);
  const oldContext = loggingContextMap.get(req);
  loggingContextMap.set(req, context);
  let ret: T;
  try {
    ret = callback();
  } catch (err) {
    if (hadOldContext) loggingContextMap.set(req, oldContext ?? {});
    else loggingContextMap.delete(req);
    throw err;
  }
  if (hadOldContext) loggingContextMap.set(req, oldContext ?? {});
  else loggingContextMap.delete(req);
  return ret;
};

export const setLoggingContext = (
  req: Request,
  context:
    | Record<string, unknown>
    | ((oldContext: Record<string, unknown>) => Record<string, unknown>),
) => {
  loggingContextMap.set(
    req,
    typeof context === "function"
      ? context(loggingContextMap.get(req) ?? {})
      : context,
  );
};

const escapeString = (value: string) => {
  if (value.match(/\s"/)) return `"${value.replace(/"/g, '\\"')}"`;
  return value;
};

export const getLoggingContext = (req: Request) => {
  const oldContext = loggingContextMap.get(req);
  if (oldContext) return oldContext;

  const newContext: Record<string, unknown> = {};
  loggingContextMap.set(req, newContext);
  return newContext;
};

const stringify = (value: unknown): string => {
  if (typeof value === "string") return escapeString(value);
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value !== "object") return value.toString();
  if (Array.isArray(value)) {
    return `[${value.map((v) => stringify(v)).join(", ")}]`;
  }
  return `{${
    Object.entries(value).map(([k, v]: [string, unknown]) =>
      `${escapeString(k)}: ${stringify(v)}`
    ).join(", ")
  }}`;
};

const getContextParts = (req: Request) => {
  const context = loggingContextMap.get(req);
  return context
    ? Object.entries(context).map(([key, value]) =>
      `${escapeString(key)}=${stringify(value)}`
    )
    : [];
};

const parts = (data: unknown[]) => {
  const [first, ...rest] = data;
  const firstIsRequest = typeof first === "object" && first instanceof Request;
  return [
    new Date(),
    ...(firstIsRequest ? rest : data),
    ...(firstIsRequest ? getContextParts(first) : []),
  ];
};

export const log = {
  error: (...data: unknown[]) => console.error(...parts(data)),
  warn: (...data: unknown[]) => console.warn(...parts(data)),
  info: (...data: unknown[]) => console.info(...parts(data)),
  debug: (...data: unknown[]) => console.debug(...parts(data)),
};
