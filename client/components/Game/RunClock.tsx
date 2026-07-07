import { h, JSX } from "preact";
import { readableInk } from "../../../common/percentileColor.ts";
import { climbColor, scorePercent, Verdict } from "./verdict.ts";

/**
 * The free-play run clock: the timer doubled as a verdict. Unlike the daily
 * clock it doesn't tick up — a free-play result is already yours, so it reads
 * the run's final time straight away, tinted to its score % (the same standing
 * ramp the runs panel uses) with that % shown beside the time. The runner still
 * animates across the board; only the number is settled. Daily attempts stay a
 * blind stopwatch (see Hud); this is free-play only.
 */
export const RunClock = (
  { to, min, best }: { to: number; min: number; best: number },
) => {
  const percent = Math.max(0, Math.min(1, scorePercent(to, min, best)));
  const color = climbColor(percent);
  return (
    <div
      class="hud__run hud__run--score"
      style={{ background: color, color: readableInk(color) }}
    >
      <span class="mono hud__run-time">
        {to.toFixed(2)}
        <span class="hud__run-s">s</span>
      </span>
      <span class="mono hud__run-pct">{Math.round(percent * 100)}%</span>
    </div>
  );
};

/**
 * The decorated pill a milestone free-play run shows while it executes: the
 * final time and score %, in the outcome's colour. Record steps out of the
 * gradient to chartreuse (a ripple ring); supreme to gold (a glow); a personal
 * best keeps its live % colour and pulses instead — colour belongs to the
 * global %.
 */
export const VerdictPill = ({ verdict }: { verdict: Verdict }) => (
  <div
    class={`hud__run hud__run--score hud__run--${verdict.outcome}`}
    style={{ background: verdict.color, color: readableInk(verdict.color) }}
  >
    {verdict.outcome === "record" && (
      <span class="hud__run-ring" aria-hidden="true" />
    )}
    <span class="mono hud__run-time">
      {verdict.time.toFixed(2)}
      <span class="hud__run-s">s</span>
    </span>
    <span class="mono hud__run-pct">{Math.round(verdict.percent * 100)}%</span>
  </div>
);

const StarIcon = () => (
  <svg width={12} height={12} viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M8 1l2 4.5 4.9.5-3.7 3.3 1.1 4.8L8 11.6 3.7 14.1l1.1-4.8L1.1 6l4.9-.5z"
      fill="currentColor"
    />
  </svg>
);

const CheckIcon = () => (
  <svg width={12} height={12} viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M3 8.5l3.4 3.4L13 4.2"
      fill="none"
      stroke="currentColor"
      stroke-width={2}
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
);

const CrownIcon = () => (
  <svg width={12} height={12} viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2 5l3 2.5L8 2l3 5.5L14 5l-1 8H3z" fill="currentColor" />
  </svg>
);

const BADGE: Record<Verdict["outcome"], { label: string; icon: JSX.Element }> =
  {
    pb: { label: "NEW PERSONAL BEST", icon: <StarIcon /> },
    record: { label: "RECORD", icon: <CheckIcon /> },
    supreme: { label: "SUPREME", icon: <CrownIcon /> },
  };

// Confetti positions (top / right, in px from the anchor under the timer), so a
// win scatters a few flecks over the board's top edge. Record ripples the pill
// itself instead, so it stays clean.
const SPARKLES = [
  { top: 8, right: 26, size: 6, delay: 0 },
  { top: 30, right: 84, size: 5, delay: 0.2 },
  { top: 4, right: 150, size: 5, delay: 0.4 },
  { top: 44, right: 200, size: 6, delay: 0.1 },
  { top: 20, right: 260, size: 4, delay: 0.3 },
];

// A personal best throws multi-hued confetti (little squares); a supreme keeps
// to golds (little sparks), matching the badge. Record ripples the pill instead,
// so it grows no confetti — its entry is unused.
const SPARK_COLORS: Record<Verdict["outcome"], string[]> = {
  record: [],
  pb: [
    "hsl(325,72%,60%)",
    "hsl(188,65%,58%)",
    "hsl(45,90%,60%)",
    "hsl(265,60%,66%)",
    "hsl(160,60%,52%)",
  ],
  supreme: [
    "hsl(45,90%,62%)",
    "hsl(45,90%,66%)",
    "hsl(45,90%,70%)",
    "hsl(45,85%,64%)",
    "hsl(45,90%,58%)",
  ],
};

/**
 * The floating win overlay: a badge anchored just under the timer and (for pb /
 * supreme) a scatter of confetti over the board's top. It's absolutely
 * positioned — never part of the HUD layout — so it hangs over the gap and the
 * board without shifting the row or moving the board. It fades itself in and
 * out; the parent clears it when the board re-stages.
 */
export const Celebration = ({ verdict }: { verdict: Verdict }) => {
  const { label, icon } = BADGE[verdict.outcome];
  return (
    <div class="celebrate" aria-hidden="true">
      <div class={`celebrate__badge celebrate__badge--${verdict.outcome}`}>
        {icon}
        <span class="celebrate__label">{label}</span>
      </div>
      {verdict.outcome !== "record" &&
        SPARKLES.map((s, i) => (
          <span
            key={i}
            class="celebrate__spark"
            style={{
              top: `${s.top}px`,
              right: `${s.right}px`,
              width: `${s.size}px`,
              height: `${s.size}px`,
              background: SPARK_COLORS[verdict.outcome][i],
              borderRadius: verdict.outcome === "supreme" ? "50%" : "1px",
              animationDelay: `${s.delay}s`,
            }}
          />
        ))}
    </div>
  );
};
