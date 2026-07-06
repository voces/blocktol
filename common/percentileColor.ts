// The design's percentile ramp (the --pct-0..4 tokens in index.html):
// red → magenta → blue → teal → green, low percentile to high (the long way
// round the wheel so it skips yellow/olive and stays vivid; green = best).
const STOPS = ["#dc4a2f", "#d13d94", "#3f6be0", "#29b3a6", "#46b95a"];

// sRGB gamma <-> linear-light.
const toLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const toGamma = (c: number) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;

// linear sRGB <-> OKLab (Björn Ottosson's matrices). OKLab is perceptually
// uniform, so interpolating there (in polar OKLCh form below) keeps the ramp's
// midpoints as vivid and evenly-lit as its stops — where the old raw-sRGB lerp
// dipped through duller, darker in-between colours.
const linToLab = (
  r: number,
  g: number,
  b: number,
): [number, number, number] => {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
};
const labToLin = (
  L: number,
  a: number,
  b: number,
): [number, number, number] => {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
};

// Each stop as OKLCh (lightness, chroma, hue-radians) — precomputed once.
const stopsLCh = STOPS.map((hex): [number, number, number] => {
  const [L, a, b] = linToLab(
    toLinear(parseInt(hex.slice(1, 3), 16) / 255),
    toLinear(parseInt(hex.slice(3, 5), 16) / 255),
    toLinear(parseInt(hex.slice(5, 7), 16) / 255),
  );
  return [L, Math.hypot(a, b), Math.atan2(b, a)];
});

/**
 * Supreme (record) sits above the ramp — gold, not the ramp's top (purple). A
 * fixed hex (the design's rating gold) so it pairs with readableInk; the theme-
 * aware sibling is the --gold token used in the result dialog.
 */
export const SUPREME_COLOR = "#f0c442";

/**
 * Peak — a non-supreme best: a run that ties the field's top time without taking
 * the record outright (someone else holds/ties it). Sits one step above the
 * ramp's green but below the reserved supreme gold — a green-yellow. Fixed hex so
 * it pairs with readableInk (calendar cell); the --peak token mirrors it for the
 * panels, exactly as SUPREME_COLOR pairs with --gold.
 */
export const PEAK_COLOR = "#9ed54a";

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
  const last = stopsLCh.length - 1;
  const i = Math.min(Math.floor(p * last), last - 1);
  const t = (p - i / last) * last;

  const [L1, C1, H1] = stopsLCh[i];
  const [L2, C2, H2] = stopsLCh[i + 1];
  const L = L1 + t * (L2 - L1);
  const C = C1 + t * (C2 - C1);
  // Interpolate hue along the shorter arc (matching CSS `in oklch`).
  let dH = H2 - H1;
  if (dH > Math.PI) dH -= 2 * Math.PI;
  else if (dH < -Math.PI) dH += 2 * Math.PI;
  const H = H1 + t * dH;

  const [r, g, b] = labToLin(L, C * Math.cos(H), C * Math.sin(H));
  const channel = (c: number) =>
    Math.round(
      Math.max(0, Math.min(1, toGamma(Math.max(0, Math.min(1, c))))) * 255,
    )
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
};

/**
 * Colour for a run's *standing* — its position in [min, fieldBest] (how close to
 * the field's best). Cubed before the ramp so the top end gets far more colour
 * resolution: players grind toward the best, so 95% → 99% is a much bigger deal
 * than 80% → 84%, and the cube spreads those top runs across a wide slice of the
 * ramp instead of a thin green sliver. A standing of exactly 1 stays 1 (still the
 * ramp's top). Ranked percentiles are uniform by construction, so those are
 * coloured linearly via percentileColor directly — NOT through this.
 */
export const standingColor = (standing: number): string =>
  percentileColor(standing ** 3);

/**
 * Banded (discrete-token) sibling of standingColor — the same cube, for the
 * panels that colour a standing off the `--pct-N` tokens rather than the
 * continuous ramp. Ranked percentiles still go through percentileBand directly.
 */
export const standingBand = (standing: number | null): string =>
  percentileBand(standing == null ? null : standing ** 3);

/** Black or white, whichever reads better on the given `#rrggbb` background. */
export const readableInk = (hex: string): string => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? "#1a1a1a" : "#fff";
};
