import {
  PEAK_COLOR,
  standingColor,
  SUPREME_COLOR,
} from "../../../common/percentileColor.ts";

// A finished free-play run's milestone, if it hit one. Drives the decorated
// timer pill and the floating badge. `none` runs (most of them) aren't stored
// here — they just re-stage without a celebration.
export type Outcome = "pb" | "record" | "supreme";

export type Verdict = {
  outcome: Outcome;
  // The run's final time, and its score % against the field best *before* this
  // run — so a solve nobody had matched reads over 100% (a supreme), unlike the
  // runs panel which re-normalises your best to 100%.
  time: number;
  percent: number;
  // The pill's fill for this outcome (gold / chartreuse / the live % colour).
  color: string;
};

// Times are floats; treat a hair's-width difference as a tie.
const EPS = 1e-4;

/**
 * A run's score against the field: (time − min) / (best − min), where `best` is
 * the field best *before* this run. Exceeds 1 when the run beats the field (a
 * supreme). Guards the degenerate empty-field case (best === min).
 */
export const scorePercent = (time: number, min: number, best: number) => {
  const denom = best - min;
  if (denom <= 0) return time > min ? 1 : 0;
  return (time - min) / denom;
};

/**
 * The colour the live pill takes as the runner climbs — the same standing ramp
 * the runs panel colours a row by, so one run reads the same colour on the timer
 * and in the list.
 */
export const climbColor = (percent: number) =>
  standingColor(Math.max(0, Math.min(1, percent)));

/**
 * Which milestone (if any) a finished free-play run hit. Priority, high → low:
 * supreme (beat the field) > record (tied it) > personal best (beat your own).
 * Record and supreme own the reserved colours (chartreuse / gold); a plain PB
 * keeps its live % colour — colour belongs to the global %, so a PB is marked by
 * motion and words instead. `best` and `ownBest` are the field / personal bests
 * from before this run.
 */
export const computeVerdict = (
  time: number,
  min: number,
  best: number,
  ownBest: number | null,
): Verdict | null => {
  const percent = scorePercent(time, min, best);

  if (time > best + EPS) {
    return { outcome: "supreme", time, percent, color: SUPREME_COLOR };
  }
  if (best > min + EPS && time >= best - EPS) {
    return { outcome: "record", time, percent, color: PEAK_COLOR };
  }
  if (ownBest != null && time > ownBest + EPS) {
    return { outcome: "pb", time, percent, color: climbColor(percent) };
  }
  return null;
};
