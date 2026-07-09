import { h } from "preact";
import { useRef, useState } from "preact/compat";

// The distance (px) a pull must pass to fire, and how far the indicator travels.
const THRESHOLD = 70;
const MAX = 110;
// Ignore the first few px so a tap on a header button still fires its click
// rather than being claimed as a pull.
const SLOP = 6;

// Pull-to-refresh, spread onto a top grab strip — the header, since the board
// owns touch below it. Drive an indicator with `pull` (0..MAX damped px) and
// `refreshing`; releasing past the threshold reloads (location.reload() re-runs
// boot and the service worker refetches the shell network-first, so every store
// comes back fresh).
//
// Runs in a browser tab too, not just the installed PWA: the app disables the
// browser's NATIVE pull-to-refresh app-wide (html/body overflow:hidden makes
// `.game` a nested scroller, plus overscroll-behavior:none), so without this
// there's no pull-to-refresh anywhere and a tab is stuck on the reload button.
// Touch only — a mouse (desktop) has a keyboard/menu reload, and mouse-drag-to-
// reload would be surprising.
export const usePullToRefresh = () => {
  const startY = useRef<number | null>(null);
  const active = useRef(false);
  const pullRef = useRef(0);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const reset = () => {
    startY.current = null;
    active.current = false;
    pullRef.current = 0;
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
        // Only a downward drag past the slop becomes a pull; upward or tiny
        // moves are left to the header's buttons.
        if (dy < SLOP) return;
        active.current = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }
      e.preventDefault();
      // Rubber-band past the threshold so the pull feels resistant near the end.
      const damped = dy < THRESHOLD ? dy : THRESHOLD + (dy - THRESHOLD) * 0.4;
      pullRef.current = Math.min(damped, MAX);
      setPull(pullRef.current);
    },
    onPointerUp: () => {
      if (!active.current) return reset();
      const trigger = pullRef.current >= THRESHOLD;
      reset();
      if (trigger) {
        setRefreshing(true);
        // Let the spinner paint one frame before the reload replaces the page.
        requestAnimationFrame(() => location.reload());
      }
    },
    onPointerCancel: () => reset(),
  };

  return { pull, refreshing, threshold: THRESHOLD, handlers };
};
