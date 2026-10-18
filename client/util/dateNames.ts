// Localized weekday initials from `Intl.DateTimeFormat` for the calendar's
// header row. Follows the passed locale (the client's `uiLocale`; undefined =
// the viewer's own) and is cached per locale, since the calendar rebuilds this
// every render and Intl constructors aren't free.

const weekdayCache = new Map<string, readonly string[]>();

// Narrow weekday initials, Sunday-first (the calendar grid starts on Sunday).
// 2023-01-01 is a Sunday.
export const narrowWeekdays = (locale?: string): readonly string[] => {
  const key = locale ?? "";
  let v = weekdayCache.get(key);
  if (!v) {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
    v = Array.from(
      { length: 7 },
      (_, i) => fmt.format(new Date(2023, 0, 1 + i)),
    );
    weekdayCache.set(key, v);
  }
  return v;
};
