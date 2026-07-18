// Localized weekday initials from `Intl.DateTimeFormat`, so the calendar's
// header row is never a hardcoded English array. Follows the passed locale (the
// client's `uiLocale`, undefined = the viewer's own) and is cached per locale —
// the board's calendar rebuilds this on every render and Intl constructors
// aren't free. English (`undefined`) renders byte-for-byte the old array
// ("S M T W T F S"). (Month/day labels use `toLocaleDateString` directly so the
// locale controls word order; only the weekday initials need this loop.)

const weekdayCache = new Map<string, readonly string[]>();

// Narrow weekday initials, Sunday-first (the calendar grid starts on Sunday).
// 2023-01-01 is a Sunday, so seven consecutive days from it span Sun…Sat.
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
