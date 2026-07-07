import { Fragment, h, JSX } from "preact";
import { createPortal, useLayoutEffect, useRef, useState } from "preact/compat";
import { formatPercentile } from "../../../common/formatPercentile.ts";
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
  // formatPercentile keeps sub-100 precision (99.7, not a rounded-up 100) and
  // only ever prints 100 for a genuine field-topping tie/supreme — so a plain PB
  // never masquerades as a record. Matches the runs panel's own formatting.
  return (
    <div
      class="hud__run hud__run--score"
      style={{ background: color, color: readableInk(color) }}
    >
      <span class="mono hud__run-time">
        {to.toFixed(2)}
        <span class="hud__run-s">s</span>
      </span>
      <span class="mono hud__run-pct">{formatPercentile(percent)}%</span>
    </div>
  );
};

/**
 * The decorated pill a milestone free-play run shows while it executes: the
 * final time and score %, in the outcome's colour. The celebration effects
 * (glow / ripple / confetti / badge) are NOT drawn on the pill — the HUD sits at
 * the top-right corner of `.game`, whose overflow is clipped for the mobile
 * scroll layout, so anything spilling above or right of the pill would be cut
 * off. Instead they render in a viewport-fixed layer anchored to the pill's
 * measured box (see CelebrationOverlay), free to spread on every side.
 */
export const VerdictPill = ({ verdict }: { verdict: Verdict }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      if (ref.current) setRect(ref.current.getBoundingClientRect());
    };
    measure();
    globalThis.addEventListener("resize", measure);
    globalThis.addEventListener("scroll", measure, true);
    return () => {
      globalThis.removeEventListener("resize", measure);
      globalThis.removeEventListener("scroll", measure, true);
    };
  }, []);

  return (
    <>
      <div
        ref={ref}
        class="hud__run hud__run--score"
        style={{ background: verdict.color, color: readableInk(verdict.color) }}
      >
        <span class="mono hud__run-time">
          {verdict.time.toFixed(2)}
          <span class="hud__run-s">s</span>
        </span>
        <span class="mono hud__run-pct">
          {formatPercentile(verdict.percent)}%
        </span>
      </div>
      {rect &&
        createPortal(
          <CelebrationOverlay verdict={verdict} rect={rect} />,
          document.body,
        )}
    </>
  );
};

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
    "hsl(220,72%,62%)",
    "hsl(45,90%,66%)",
  ],
  supreme: [
    "hsl(45,90%,62%)",
    "hsl(45,90%,66%)",
    "hsl(45,90%,70%)",
    "hsl(45,85%,64%)",
    "hsl(45,90%,58%)",
    "hsl(42,88%,60%)",
    "hsl(48,90%,68%)",
  ],
};

// Confetti scattered on every side of the pill, as fractions of its box: fx/fy
// are the anchor corner (0 = left/top edge, 1 = right/bottom edge) and dx/dy a
// pixel nudge past it. So negative dy sits above the pill, dx past the right
// edge sits to its right, and a positive dy past the bottom edge rains down over
// the board — a burst that surrounds the button and falls below it rather than
// trailing off one side. `d` staggers the twinkle.
const SPARKS = [
  // Above the pill.
  { fx: 0.2, fy: 0, dx: 0, dy: -22, size: 6, d: 0 },
  { fx: 0.6, fy: 0, dx: 10, dy: -30, size: 5, d: 0.3 },
  { fx: 1, fy: 0, dx: 16, dy: -10, size: 5, d: 0.5 },
  { fx: 0, fy: 0, dx: -14, dy: -16, size: 4, d: 0.45 },
  // Either side.
  { fx: 1, fy: 0.5, dx: 16, dy: 0, size: 4, d: 0.15 },
  { fx: 0, fy: 0.5, dx: -22, dy: 2, size: 5, d: 0.2 },
  // Below, raining down over the board's top.
  { fx: 1, fy: 1, dx: 18, dy: 20, size: 5, d: 0.4 },
  { fx: 0.15, fy: 1, dx: -6, dy: 26, size: 6, d: 0.1 },
  { fx: 0, fy: 1, dx: -26, dy: 40, size: 4, d: 0.55 },
  { fx: 0.45, fy: 1, dx: 0, dy: 54, size: 5, d: 0.25 },
  { fx: 0.8, fy: 1, dx: 8, dy: 48, size: 6, d: 0.6 },
  { fx: 0.3, fy: 1, dx: -4, dy: 78, size: 4, d: 0.35 },
  { fx: 0.65, fy: 1, dx: 6, dy: 88, size: 5, d: 0.7 },
];

/**
 * The free-play win overlay, fixed to the viewport and anchored over the pill's
 * measured box so it escapes `.game`'s clipped overflow — glow, ripple, confetti
 * and badge can all spill above / right / around the button without being cut.
 * It fires the instant the run commits (the result is already known) and plays
 * over the run; the pill unmounts it when the board re-stages at finish.
 */
const CelebrationOverlay = (
  { verdict, rect }: { verdict: Verdict; rect: DOMRect },
) => {
  const { label, icon } = BADGE[verdict.outcome];
  return (
    <div
      class="celebrate"
      aria-hidden="true"
      style={{
        top: `${rect.top}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      }}
    >
      {
        /* Glow / ripple over the pill's footprint (a transparent overlay, so the
          time reads through) — unclipped up here in the fixed layer. */
      }
      {verdict.outcome === "record" ? <span class="celebrate__ring" /> : (
        <span
          class={`celebrate__glow celebrate__glow--${verdict.outcome}`}
        />
      )}
      <div class={`celebrate__badge celebrate__badge--${verdict.outcome}`}>
        {icon}
        <span class="celebrate__label">{label}</span>
      </div>
      {verdict.outcome !== "record" &&
        SPARKS.map((s, i) => (
          <span
            key={i}
            class="celebrate__spark"
            style={{
              left: `${s.fx * rect.width + s.dx}px`,
              top: `${s.fy * rect.height + s.dy}px`,
              width: `${s.size}px`,
              height: `${s.size}px`,
              background: SPARK_COLORS[verdict.outcome][
                i % SPARK_COLORS[verdict.outcome].length
              ],
              borderRadius: verdict.outcome === "supreme" ? "50%" : "1px",
              animationDelay: `${s.d}s`,
            }}
          />
        ))}
    </div>
  );
};
