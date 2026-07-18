import { ComponentChildren, h } from "preact";
import { useDragToClose } from "../hooks/useDragToClose.ts";
import { t } from "../util/t.ts";

/**
 * A dismissible overlay: a bottom sheet on mobile, a centered card on desktop
 * (purely CSS, see `.modal`). Tapping the backdrop closes it; the sheet stops
 * propagation so taps inside don't. On mobile a grab notch sits at the top —
 * tap or drag down to close, matching the standings sheet — while desktop
 * keeps each dialog's × (the notch hides; see `.modal__handle`). Children own
 * their own padding — pass a `class` for per-use tweaks (e.g.
 * `profile-sheet`).
 */
export const Modal = (
  { onClose, class: cls, children }: {
    onClose: () => void;
    class?: string;
    children: ComponentChildren;
  },
) => {
  const { offset, handlers } = useDragToClose(onClose);
  return (
    <div class="modal" onClick={onClose}>
      <div
        class={"modal__sheet" + (cls ? ` ${cls}` : "")}
        style={offset ? { transform: `translateY(${offset}px)` } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          class="modal__handle tapc"
          aria-label={t("a11y.close")}
          onClick={onClose}
          {...handlers}
        />
        {children}
      </div>
    </div>
  );
};
