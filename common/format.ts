// Locale-aware number formatting, shared by the server (push copy) and the
// client so a value reads identically everywhere. Locale mirrors how
// formatNotifDate already handles dates: the client passes `undefined` and gets
// the viewer's own locale, while server-rendered push text passes the
// recipient's stored locale (the user.locale column) — falling back to the
// runtime's locale when there's none.

// Constructing an Intl.NumberFormat isn't free and the board renders a whole
// column of times, so cache by (locale, options). A malformed stored locale
// would make the constructor throw, so fall back to the runtime default rather
// than let one bad value break push rendering.
const cache = new Map<string, Intl.NumberFormat>();
const formatter = (
  locale: string | undefined,
  options: Intl.NumberFormatOptions,
): Intl.NumberFormat => {
  const key = `${locale ?? ""}|${JSON.stringify(options)}`;
  let f = cache.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(locale, options);
    } catch {
      f = new Intl.NumberFormat(undefined, options);
    }
    cache.set(key, f);
  }
  return f;
};

export type FormatOptions = {
  // Fraction-digit bounds, kept per-call rather than baked in: the board and
  // notifications show two decimals, share/inline text a variable count.
  min?: number;
  max?: number;
  // A specific locale for server-rendered copy; omit on the client so the
  // viewer's own locale is used.
  locale?: string;
};

// A general ungrouped decimal — the zoom multiplier, the rank's "~1.9k"
// approximation. min 0 / max 2 by default, so trailing zeros drop.
export const formatDecimal = (
  value: number,
  { min = 0, max = 2, locale }: FormatOptions = {},
): string =>
  formatter(locale, {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
    useGrouping: false,
  }).format(value);

// A seconds value as a fixed-precision, locale-decimal string WITHOUT a unit
// ("35.10" / "35,10") — the "s" stays in the caller's markup so the board keeps
// it a separately styled span. Grouping is off: times sit in mono-aligned
// columns a thousands separator would break (and never reach thousands anyway).
// Two decimals by default (the board and notifications); share/inline text
// passes { min: 0 } to keep its variable-precision look.
export const formatSeconds = (
  value: number,
  options: FormatOptions = {},
): string => formatDecimal(value, { min: 2, max: 2, ...options });

// A whole-number count (field sizes, "N between") WITH locale grouping —
// "1,900" / "1.900". Used off the mono columns, where grouping reads well.
export const formatCount = (value: number, locale?: string): string =>
  formatter(locale, { maximumFractionDigits: 0 }).format(value);
