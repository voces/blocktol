import { h } from "preact";
import { useRef, useState } from "preact/compat";

// Drag-down-to-close for mobile bottom sheets. Spread `handlers` onto the
// sheet's grab areas (the notch, a header), which need `touch-action: none`,
// and translate the sheet by `offset` while a drag is live. Releasing past the
// threshold closes; under it, the sheet snaps back. Mouse pointers are ignored:
// desktop dialogs aren't sheets, and mouse-drag would fight text selection.
export const useDragToClose = (onClose: () => void, threshold = 90) => {
  const startY = useRef<number | null>(null);
  // Mirrors `offset` so the release handler reads the final value without
  // re-registering per move.
  const offsetRef = useRef(0);
  const [offset, setOffset] = useState(0);

  const end = () => {
    if (startY.current == null) return;
    const passed = offsetRef.current > threshold;
    startY.current = null;
    offsetRef.current = 0;
    setOffset(0);
    if (passed) onClose();
  };

  const handlers = {
    onPointerDown: (e: h.JSX.TargetedPointerEvent<HTMLElement>) => {
      if (e.pointerType === "mouse") return;
      startY.current = e.clientY;
      offsetRef.current = 0;
      // Keep receiving moves even once the finger leaves the grab area. Old
      // WebKit lacks pointer capture.
      // oxlint-disable-next-line typescript/no-unnecessary-condition
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e: h.JSX.TargetedPointerEvent<HTMLElement>) => {
      if (startY.current == null) return;
      const next = Math.max(0, e.clientY - startY.current);
      offsetRef.current = next;
      setOffset(next);
    },
    onPointerUp: end,
    onPointerCancel: end,
  };

  return { offset, handlers };
};
