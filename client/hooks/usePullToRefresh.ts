import { h } from "preact";
import { useRef, useState } from "preact/compat";

// True when running as an installed app (Android/desktop PWA or an iOS
// home-screen app), where there's no browser reload button or URL bar.
const isStandalone = () =>
  globalThis.matchMedia?.("(display-mode: standalone)").matches === true ||
  // iOS Safari's home-screen flag (not covered by display-mode there).
  (navigator as unknown as { standalone?: boolean }).standalone === true;

// The distance (px) a pull must pass to fire, and how far the indicator travels.
const THRESHOLD = 70;
const MAX = 110;
// Ignore the first few px so a tap on a header button still fires its click
// rather than being claimed as a pull.
const SLOP = 6;

// Pull-to-refresh for the installed PWA. Spread `handlers` onto a top grab
// strip — the header, since the board owns touch below it — and render an
// indicator driven by `pull` (0..MAX damped px) and `refreshing`. Releasing
// past the threshold reloads the app: location.reload() re-runs boot and the
// service worker refetches the shell network-first, so every store comes back
// fresh — the standalone equivalent of the browser's reload.
//
// Touch only (a desktop PWA has a window menu with reload), and completely
// inert outside standalone, so a normal browser tab — which still has its own
// reload — sees no behaviour change and the indicator never appears.
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
      if (e.pointerType === "mouse" || refreshing || !isStandalone()) return;
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
