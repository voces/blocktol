// Locale-aware number formatting shared by the server (push copy) and the
// client. As with formatNotifDate, the client passes `undefined` and gets its
// UI language (`setDefaultLocale`), while server push text passes the
// recipient's stored `user.locale`, falling back to the runtime locale.

// Intl.NumberFormat construction is costly and the board renders a column of
// times, so cache by (locale, options). A malformed stored locale makes the
// constructor throw; fall back to the runtime default so one bad value can't
// break push rendering.
const cache = new Map<string, Intl.NumberFormat>();

// The client's UI language (set by `applyLanguage`), used when a call names no
// locale, so a time reads "35,10" under a German UI on an English browser. The
// server never sets it.
let defaultLocale: string | undefined;
export const setDefaultLocale = (locale: string | undefined) => {
  defaultLocale = locale;
};

const formatter = (
  requested: string | undefined,
  options: Intl.NumberFormatOptions,
): Intl.NumberFormat => {
  const locale = requested ?? defaultLocale;
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
  // Fraction-digit bounds are per call: the board and notifications show two
  // decimals, share/inline text a variable count.
  min?: number;
  max?: number;
  // For server-rendered copy; omit on the client.
  locale?: string;
};

// A general ungrouped decimal (zoom multiplier, "~1.9k" rank). Defaults to
// min 0 / max 2, so trailing zeros drop.
export const formatDecimal = (
  value: number,
  { min = 0, max = 2, locale }: FormatOptions = {},
): string =>
  formatter(locale, {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
    useGrouping: false,
  }).format(value);

// Seconds as a locale-decimal string WITHOUT a unit ("35.10" / "35,10"); the
// "s" stays in the caller's markup so the board can style it. Ungrouped, since
// times sit in mono-aligned columns. Two decimals by default; share/inline text
// passes { min: 0 }.
export const formatSeconds = (
  value: number,
  options: FormatOptions = {},
): string => formatDecimal(value, { min: 2, max: 2, ...options });

// A whole-number count (field sizes, "N between") WITH locale grouping:
// "1,900" / "1.900". For use outside the mono columns.
export const formatCount = (value: number, locale?: string): string =>
  formatter(locale, { maximumFractionDigits: 0 }).format(value);
