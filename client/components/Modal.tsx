import { ComponentChildren, h } from "preact";

/**
 * A dismissible overlay: a bottom sheet on mobile, a centered card on desktop
 * (purely CSS, see `.modal`). Tapping the backdrop closes it; the sheet stops
 * propagation so taps inside don't. Children own their own padding — pass a
 * `class` for per-use tweaks (e.g. `profile-sheet`).
 */
export const Modal = (
  { onClose, class: cls, children }: {
    onClose: () => void;
    class?: string;
    children: ComponentChildren;
  },
) => (
  <div class="modal" onClick={onClose}>
    <div
      class={"modal__sheet" + (cls ? ` ${cls}` : "")}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  </div>
);
