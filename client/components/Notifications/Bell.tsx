import { Fragment, h } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/compat";
import {
  bellNudge,
  fetchNotifications,
  unreadCount,
} from "../../store/notifications.ts";
import { GameStateContext } from "../Game/useGameState.ts";
import { t } from "../../util/t.ts";
import { Bell as BellIcon } from "./icons.tsx";
import { NotificationsPanel } from "./Panel.tsx";

// The header bell: unread badge (capped "9+"); tapping opens the panel. Warms
// the list on intent so the panel opens on data.
export const NotificationsBell = () => {
  const { dailyInProgress } = useContext(GameStateContext);
  const [open, setOpen] = useState(false);
  const count = unreadCount.value;

  // Swing when the unread count rises while the app is open. The ref keeps a
  // remount (e.g. after a daily finishes) and the initial load from swinging.
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

  // Hidden only mid-run on today's ranked daily, so a notification tap can't
  // navigate the board away; mirrors the calendar / profile buttons.
  if (dailyInProgress) return null;

  return (
    <>
      <button
        type="button"
        class={"icon-button notif-bell tapc" +
          (swing ? " notif-bell--swing" : "")}
        onClick={() => setOpen(true)}
        onPointerEnter={() => void fetchNotifications()}
        onFocus={() => void fetchNotifications()}
        title={t("notif.bell.title")}
        aria-label={count > 0
          ? t("notif.bell.unread", { count })
          : t("notif.bell.title")}
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
