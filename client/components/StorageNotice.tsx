import { h } from "preact";
import { useState } from "preact/compat";
import { Toast } from "./Toast.tsx";
import { t } from "../util/t.ts";

// Heads-up shown when the browser blocks site storage (see util/storage.ts):
// the app is on the in-memory fallback, so the device identity and any
// in-progress game are lost on reload. Reuses the Toast chrome with an info
// glyph. Dismissible for the session only: remembering the dismissal would need
// the blocked storage, and the data loss persists on the next reload.
//
// Rendered only in the main game view, never over onboarding or the move gate.
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
