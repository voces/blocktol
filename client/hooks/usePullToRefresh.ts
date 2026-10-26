import { h } from "preact";
import { useRef, useState } from "preact/compat";

// The distance (px) a pull must pass to fire, and how far the indicator
// travels.
const THRESHOLD = 70;
const MAX = 110;
// Ignore the first few px so a tap on a header button still fires its click.
const SLOP = 6;

// Pull-to-refresh, spread onto the header (the board owns touch below it).
// Drive an indicator with `pull` (0..MAX damped px) and `refreshing`; releasing
// past the threshold reloads, which re-runs boot (the service worker fetches
// the shell network-first).
//
// Runs in a browser tab too: the app disables the browser's native
// pull-to-refresh app-wide (`overflow: hidden` on html/body, plus
// `overscroll-behavior: none`). Touch only; desktop has a reload shortcut.
export const usePullToRefresh = () => {
  const startY = useRef<number | null>(null);
  const active = useRef(false);
  const pullRef = useRef(0);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // While a finger drives the pull the indicator tracks it 1:1 (no transition);
  // clearing this on release lets the CSS transition on .pull-refresh (disabled
  // by --dragging) ease it back, and keeps the chip mounted through the
  // retract.
  const [dragging, setDragging] = useState(false);

  // Ease back to rest: `dragging` goes false so the transition plays.
  const settle = () => {
    startY.current = null;
    active.current = false;
    pullRef.current = 0;
    setDragging(false);
    setPull(0);
  };

  const handlers = {
    onPointerDown: (e: h.JSX.TargetedPointerEvent<HTMLElement>) => {
      if (e.pointerType === "mouse" || refreshing) return;
      startY.current = e.clientY;
      active.current = false;
    },
    onPointerMove: (e: h.JSX.TargetedPointerEvent<HTMLElement>) => {
      if (startY.current == null) return;
      const dy = e.clientY - startY.current;
      if (!active.current) {
        // Only a downward drag past the slop becomes a pull.
        if (dy < SLOP) return;
        active.current = true;
        setDragging(true);
        // Old WebKit lacks pointer capture.
        // oxlint-disable-next-line typescript/no-unnecessary-condition
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }
      e.preventDefault();
      // Rubber-band past the threshold so the pull feels resistant near the
      // end.
      const damped = dy < THRESHOLD ? dy : THRESHOLD + (dy - THRESHOLD) * 0.4;
      pullRef.current = Math.min(damped, MAX);
      setPull(pullRef.current);
    },
    onPointerUp: () => {
      if (!active.current) return settle();
      const trigger = pullRef.current >= THRESHOLD;
      if (trigger) {
        active.current = false;
        startY.current = null;
        setDragging(false);
        setRefreshing(true);
        // Let the spinner paint one frame before the reload replaces the page.
        requestAnimationFrame(() => location.reload());
      } else {
        settle();
      }
    },
    onPointerCancel: () => settle(),
  };

  return { pull, refreshing, dragging, threshold: THRESHOLD, handlers };
};
