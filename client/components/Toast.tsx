import { ComponentChildren, h } from "preact";

// A status toast, bottom-centered over the board. Used after a silent profile
// adopt (the move/merge gate stashes it in sessionStorage; App renders it on the
// next boot — see MoveGate.reloadAs and App) and for the storage-blocked heads-up
// (StorageNotice). The default icon is a success check; pass `icon` to override
// it (e.g. an info glyph for a non-success message).
const CheckCircle = () => (
  <svg width={20} height={20} viewBox="0 0 20 20" aria-hidden="true">
    <circle cx={10} cy={10} r={9} fill="var(--win)" />
    <path
      d="M6 10.2l2.6 2.6L14 7.4"
      fill="none"
      stroke="#fff"
      stroke-width={1.9}
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
);

export const Toast = (
  { title, sub, onClose, icon }: {
    title: string;
    sub?: string;
    onClose: () => void;
    icon?: ComponentChildren;
  },
) => (
  <div class="toast" role="status">
    <span class="toast__icon">
      {icon ?? <CheckCircle />}
    </span>
    <div class="toast__body">
      <div class="toast__title">{title}</div>
      {sub && <div class="toast__sub">{sub}</div>}
    </div>
    <button
      type="button"
      class="toast__close tapc"
      aria-label="Dismiss"
      onClick={onClose}
    >
      ×
    </button>
  </div>
);
