import {
  PEAK_COLOR,
  standingColor,
  SUPREME_COLOR,
} from "../../../common/percentileColor.ts";

// A finished free-play run's milestone. Drives the decorated timer pill and
// the floating badge; a run with no milestone has no Verdict.
export type Outcome = "pb" | "record" | "supreme";

export type Verdict = {
  outcome: Outcome;
  // The final time, and its score % against the field best *before* this run,
  // so a supreme reads over 100% (the runs panel re-normalises your best to
  // 100%).
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
 * The live pill's colour as the runner climbs: the runs panel's standing ramp,
 * so a run reads the same on the timer and in the list.
 */
export const climbColor = (percent: number) =>
  standingColor(Math.max(0, Math.min(1, percent)));

/**
 * Which milestone (if any) a finished free-play run hit, highest first: supreme
 * (beat the field) > record (tied it) > personal best (beat your own). Record
 * and supreme own the reserved colours (chartreuse / gold); colour belongs to
 * the global %, so a plain PB keeps its live % colour. `best` and `ownBest` are
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
