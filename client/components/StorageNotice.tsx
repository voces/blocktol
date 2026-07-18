import { h } from "preact";
import { useState } from "preact/compat";

// Shown when the browser is blocking site storage (see util/storage.ts): the app
// is running on the in-memory fallback, so the per-device identity and any
// in-progress game are lost on reload. Tells the player why and points at the
// fix (allow cookies / site data), and can be dismissed for the session. The
// dismissal itself deliberately isn't remembered — that would need the very
// storage that's blocked — and re-showing on the next reload is correct, since
// the underlying condition (and the data loss) is still there.
export const StorageNotice = () => {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div class="storage-notice" role="status">
      <div class="storage-notice__body">
        <div class="storage-notice__title">Progress won't be saved</div>
        <div class="storage-notice__sub">
          Your browser is blocking site storage, so your profile and games reset
          when you reload. Allow cookies / site data for this site to keep them.
        </div>
      </div>
      <button
        type="button"
        class="storage-notice__close tapc"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
      >
        ×
      </button>
    </div>
  );
};
