import { signal } from "@preact/signals";
import { Point } from "../../../common/types.ts";

// Pointer-frequency interaction state as signals. These change on every
// mousemove/touchmove; as context state each write would re-render the whole
// game tree. As signals only the component reading `.value` (the board area)
// re-renders. Handlers read them via `.peek()`/`.value` like a ref, so the
// input effects don't need them as dependencies.

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

// Seconds into the runner's walk while one is animating, else undefined (Runner
// clears it on unmount). Written every animation frame, hence a signal. The
// splits tape reads it through a computed that collapses it to the mark the
// runner has reached, so the tape re-renders only when that moves.
export const runnerTime = signal<number | undefined>(undefined);

// Whether the previewed placement/move is illegal (red preview).
export const invalid = signal(false);

// Whether the current grab has really moved off its origin (sticky; see
// useInputStart) — hides the upgrade radius for the rest of the drag.
export const dragMoved = signal(false);

// A touch gesture is in progress (drives the placing zoom).
export const touching = signal(false);

// The placing zoom is armed on a delay (settings.zoomDelay) so a quick tap can
// finish before the board magnifies. `armTouchZoom` schedules it (at once when
// the delay is 0). `clearTouchZoom` cancels a pending arm AND turns the zoom
// off; route every gesture-end / reset through it rather than writing
// `touching`, or a lingering timer re-zooms after release.
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
