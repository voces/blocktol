import { Fragment, h } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/compat";
import {
  bellNudge,
  fetchNotifications,
  unreadCount,
} from "../../store/notifications.ts";
import { GameStateContext } from "../Game/useGameState.ts";
import { Bell as BellIcon } from "./icons.tsx";
import { NotificationsPanel } from "./Panel.tsx";

// The header bell, to the left of the profile. Shows a count badge while unread
// (capped "9+"); tapping opens the panel. Warms the list on intent so the panel
// opens on data, not an empty shell.
export const NotificationsBell = () => {
  const { dailyInProgress } = useContext(GameStateContext);
  const [open, setOpen] = useState(false);
  const count = unreadCount.value;

  // A quick, silent visual swing when the unread count rises while the app is
  // open (a notification just arrived). Guarded by a ref so re-mounting the bell
  // — e.g. after a daily finishes — doesn't replay it, and so the initial load
  // never swings.
  const nudge = bellNudge.value;
  const seen = useRef(nudge);
  const [swing, setSwing] = useState(false);
  useEffect(() => {
    if (nudge > seen.current) {
      seen.current = nudge;
      setSwing(true);
      const t = setTimeout(() => setSwing(false), 750);
      return () => clearTimeout(t);
    }
    seen.current = nudge;
  }, [nudge]);

  // Hidden only while mid-run on today's ranked daily — mirrors the calendar /
  // profile buttons, and keeps a notification tap from navigating the board away
  // mid-run. On a past day (deep link / held across midnight) it stays available.
  if (dailyInProgress) return null;

  return (
    <>
      <button
        type="button"
        class={"icon-button notif-bell tapc" +
          (swing ? " notif-bell--swing" : "")}
        onClick={() => setOpen(true)}
        onPointerEnter={() => fetchNotifications()}
        onFocus={() => fetchNotifications()}
        title="Notifications"
        aria-label={count > 0
          ? `Notifications (${count} unread)`
          : "Notifications"}
      >
        <BellIcon filled={count > 0} />
        {count > 0 && (
          <span class="notif-bell__badge mono" aria-hidden="true">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>
      {open && <NotificationsPanel onClose={() => setOpen(false)} />}
    </>
  );
};
