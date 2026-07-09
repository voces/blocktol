import { Fragment, h } from "preact";
import { useContext, useState } from "preact/compat";
import { fetchNotifications, unreadCount } from "../../store/notifications.ts";
import { GameStateContext } from "../Game/useGameState.ts";
import { Bell as BellIcon } from "./icons.tsx";
import { NotificationsPanel } from "./Panel.tsx";

// The header bell, to the left of the profile. Shows a count badge while unread
// (capped "9+"); tapping opens the panel. Warms the list on intent so the panel
// opens on data, not an empty shell.
export const NotificationsBell = () => {
  const { attemptsRemaining } = useContext(GameStateContext);
  const [open, setOpen] = useState(false);
  const count = unreadCount.value;

  // Hidden while a daily is in progress — mirrors the calendar/profile buttons,
  // and keeps a notification tap from navigating the board away mid-run.
  if (attemptsRemaining !== 0) return null;

  return (
    <>
      <button
        type="button"
        class="icon-button notif-bell tapc"
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
