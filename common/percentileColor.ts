// The design's percentile ramp (the --pct-0..4 tokens in index.html):
// red → magenta → blue → teal → green, low percentile to high (the long way
// round the wheel so it skips yellow/olive and stays vivid; green = best).
const R = [220, 209, 63, 41, 70];
const G = [74, 61, 107, 179, 185];
const B = [47, 148, 224, 166, 90];

/**
 * Supreme (record) sits above the ramp — gold, not the ramp's top (purple). A
 * fixed hex (the design's rating gold) so it pairs with readableInk; the theme-
 * aware sibling is the --gold token used in the result dialog.
 */
export const SUPREME_COLOR = "#f0c442";

/**
 * Banded colour for a percentile in [0, 1] — the nearest stop on the SAME ramp
 * the calendar uses, so both share one scale; only the calendar tweens between
 * stops (generalized UI stays banded). Gold is reserved for supreme (the record)
 * and is passed in by callers, NOT returned here (so a merely-100% run doesn't
 * masquerade as the record). Used by today-result, attempts, and the result
 * modal.
 */
export const percentileBand = (fraction: number | null): string => {
  if (fraction == null) return "var(--text-mute)";
  const stop = Math.round(Math.max(0, Math.min(1, fraction)) * 4);
  return `var(--pct-${stop})`;
};

/** Continuous colour for a percentile in [0, 1], interpolated along the ramp. */
export const percentileColor = (percent: number): string => {
  const p = Math.max(0, Math.min(1, percent));
  const last = R.length - 1;
  const i = Math.min(Math.floor(p * last), last - 1);
  const t = (p - i / last) * last;
  const channel = (c: number[]) =>
    Math.round(c[i] + t * (c[i + 1] - c[i])).toString(16).padStart(2, "0");
  return `#${channel(R)}${channel(G)}${channel(B)}`;
};

/** Black or white, whichever reads better on the given `#rrggbb` background. */
export const readableInk = (hex: string): string => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? "#1a1a1a" : "#fff";
};
