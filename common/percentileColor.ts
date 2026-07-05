// The design's percentile ramp (the --pct-0..4 tokens in index.html):
// red → yellow → green → blue → purple, low percentile to high.
const R = [220, 224, 92, 63, 122];
const G = [74, 168, 194, 107, 85];
const B = [47, 0, 74, 224, 224];

/**
 * Supreme (record) sits above the ramp — gold, not the ramp's top (purple). A
 * fixed hex (the design's rating gold) so it pairs with readableInk; the theme-
 * aware sibling is the --gold token used in the result dialog.
 */
export const SUPREME_COLOR = "#f0c442";

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
