import { signal } from "@preact/signals";
import { Point } from "../../../common/types.ts";

// Pointer-frequency interaction state as signals. These change on every
// mousemove/touchmove; as context state they re-rendered the entire game tree
// at pointer speed (every write rebuilt the context value, and every consumer
// re-rendered). As signals, writes bypass the render path entirely and only
// the component reading `.value` — the board area — re-renders. Handlers read
// the latest value via `.peek()`/`.value` like a ref, so the input effects no
// longer need these in their dependency arrays either.

export type PlacingBlock = Point & { placing: boolean };
export type BoardBlock = Point & {
  local?: boolean;
  thunder?: boolean;
  active?: boolean;
};

// The placement preview / grabbed block's current cell.
export const placingBlock = signal<PlacingBlock>({
  x: 0,
  y: 0,
  placing: false,
});

// The local block a hover or drag currently concerns (upgrade radius, drag
// origin hiding).
export const transitionBlock = signal<BoardBlock | undefined>(undefined);

// A fixed thunder block being hovered (its radius preview).
export const thunderHover = signal<(Point & { local?: boolean }) | undefined>(
  undefined,
);

// How far into the runner's walk we are, in seconds, while one is animating —
// undefined the rest of the time (Runner clears it when it unmounts). Written
// on every animation frame, which is why it belongs here and not in game
// state: at frame frequency a context value would re-render the whole tree.
// The splits tape reads it through a computed that collapses it to "which mark
// has the runner reached", so the tape re-renders only when that answer moves.
export const runnerTime = signal<number | undefined>(undefined);

// Whether the previewed placement/move is illegal (red preview).
export const invalid = signal(false);

// Whether the current grab has really moved off its origin (sticky; see
// useInputStart) — hides the upgrade radius for the rest of the drag.
export const dragMoved = signal(false);

// A touch gesture is in progress (drives the placing zoom).
export const touching = signal(false);

// The placing zoom is armed on a delay (settings.zoomDelay) so a quick
// tap-to-place can finish before the board magnifies — a plain tap then never
// triggers the disorienting zoom-in/zoom-out. `armTouchZoom` schedules the zoom
// (immediately when the delay is 0, the default); `clearTouchZoom` both cancels
// a still-pending arm and turns the zoom off, so every gesture-end / reset path
// routes through it rather than poking `touching` directly (a lingering timer
// would otherwise re-zoom after release).
let zoomTimer: ReturnType<typeof setTimeout> | undefined;

export const armTouchZoom = (delayMs: number) => {
  clearTouchZoom();
  if (delayMs <= 0) {
    touching.value = true;
    return;
  }
  zoomTimer = setTimeout(() => {
    zoomTimer = undefined;
    touching.value = true;
  }, delayMs);
};

export const clearTouchZoom = () => {
  if (zoomTimer !== undefined) {
    clearTimeout(zoomTimer);
    zoomTimer = undefined;
  }
  touching.value = false;
};
