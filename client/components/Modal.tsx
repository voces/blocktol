import { ComponentChildren, h } from "preact";
import { useEffect, useRef } from "preact/compat";
import { useDragToClose } from "../hooks/useDragToClose.ts";
import { t } from "../util/t.ts";

// Open modals, oldest first — Escape belongs to the last.
const openStack: object[] = [];

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
  const sheet = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  // A dialog for assistive tech and the keyboard: focus moves into the sheet
  // when it opens (and back to whatever had it when it closes), and Escape
  // closes it — only the TOPMOST one, since a sheet can open over another
  // (Profile → delete account) and one keypress shouldn't dismiss both.
  useEffect(() => {
    const token = {};
    openStack.push(token);
    const before = document.activeElement;
    sheet.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      // defaultPrevented: something inside (an open dropdown) already used
      // this Escape to close itself.
      if (
        e.key !== "Escape" || e.defaultPrevented ||
        openStack[openStack.length - 1] !== token
      ) return;
      e.preventDefault();
      close.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      openStack.splice(openStack.indexOf(token), 1);
      if (before instanceof HTMLElement && before.isConnected) {
        before.focus({ preventScroll: true });
      }
    };
  }, []);

  return (
    <div class="modal" onClick={onClose}>
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        class={"modal__sheet" + (cls ? ` ${cls}` : "")}
        // No ring on the sheet itself: it only takes focus to hand it in.
        style={{
          outline: "none",
          ...(offset ? { transform: `translateY(${offset}px)` } : {}),
        }}
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
