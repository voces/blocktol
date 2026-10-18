import { ComponentChildren, h } from "preact";
import { useEffect, useRef } from "preact/compat";
import { useDragToClose } from "../hooks/useDragToClose.ts";
import { t } from "../util/t.ts";

// Open modals, oldest first — Escape belongs to the last.
const openStack: object[] = [];

/**
 * A dismissible overlay: a bottom sheet on mobile, a centered card on desktop
 * (CSS only, see `.modal`). Backdrop taps close it; the sheet stops them.
 * On mobile a grab notch closes on tap or drag down, like the standings sheet;
 * on desktop it hides (`.modal__handle`) and each dialog keeps its ×. Children
 * own their padding; `class` adds per-use tweaks (e.g. `profile-sheet`).
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

  // Focus moves into the sheet on open and back on close; Escape closes only
  // the TOPMOST modal, since a sheet can open over another (Profile → delete
  // account).
  useEffect(() => {
    const token = {};
    openStack.push(token);
    const before = document.activeElement;
    sheet.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      // defaultPrevented: something inside (an open dropdown) already used this
      // Escape.
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
