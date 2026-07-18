import { h } from "preact";
import { useState } from "preact/compat";
import { Toast } from "./Toast.tsx";
import { t } from "../util/t.ts";

// A quiet heads-up shown when the browser is blocking site storage (see
// util/storage.ts): the app is on the in-memory fallback, so the per-device
// identity and any in-progress game are lost on reload. It reuses the Toast
// chrome — same muted bottom-centered card as the profile-adopt toast, just with
// an info glyph instead of the success check — so it reads as a passing note,
// not an alert. Dismissible for the session; the dismissal deliberately isn't
// remembered (that would need the very storage that's blocked), and re-showing
// on the next reload is correct since the data loss is still there.
//
// Rendered only in the main game view, never over onboarding or the move gate —
// a first-run tour is the wrong moment to interrupt.
const InfoCircle = () => (
  <svg width={20} height={20} viewBox="0 0 20 20" aria-hidden="true">
    <circle cx={10} cy={10} r={9} fill="var(--text-faint)" />
    <path
      d="M10 8.6v5"
      fill="none"
      stroke="var(--surface)"
      stroke-width={1.9}
      stroke-linecap="round"
    />
    <circle cx={10} cy={6} r={1.15} fill="var(--surface)" />
  </svg>
);

export const StorageNotice = () => {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <Toast
      icon={<InfoCircle />}
      title={t("storage.blocked.title")}
      sub={t("storage.blocked.body")}
      onClose={() => setDismissed(true)}
    />
  );
};
