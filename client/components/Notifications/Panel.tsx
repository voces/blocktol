import { Fragment, h } from "preact";
import { useEffect } from "preact/compat";
import {
  DailyFinalData,
  formatNotifDate,
  formatNotifTime,
  notificationText,
} from "../../../common/notifications.ts";
import { useDragToClose } from "../../hooks/useDragToClose.ts";
import { navigateToNotification } from "../../store/notifNav.ts";
import {
  markRead,
  NotificationItem,
  notifications as notifSignal,
  refreshNotifications,
} from "../../store/notifications.ts";
import { formatAgo } from "../Standings/helpers.ts";
import { Crown, Flag } from "./icons.tsx";

// A daily outcome's accent — the tile hue and the emphasis colour, mirroring the
// standings record palette: gold for an outright top (supreme / a held record),
// chartreuse (--peak) for a shared/edged top, neutral for an ordinary finish.
const dailyAccent = (v: DailyFinalData["variant"]): string | null =>
  v === "supreme" || v === "record"
    ? "var(--gold)"
    : v === "first" || v === "t1"
    ? "var(--peak)"
    : null;

// One card. The tile icon + accent come from the kind/outcome; the title/body
// are the shared copy; a detail line adds the time comparison where it helps.
const Item = (
  { item, onOpen }: { item: NotificationItem; onOpen: () => void },
) => {
  const { title, body } = notificationText(item);
  const accent = item.kind === "lost_top"
    ? "var(--gold)"
    : dailyAccent((item.data as DailyFinalData).variant);

  // The comparison line: for a plain daily finish, own time vs the day's best;
  // for a lost top, it's already in the body.
  let detail: string | null = null;
  if (item.kind === "daily_final") {
    const d = item.data as DailyFinalData;
    if (d.variant === "none") {
      detail = `your ${formatNotifTime(d.yourTime)} · day's best ${
        formatNotifTime(d.dayBest)
      }`;
    }
  }

  const link = item.kind === "lost_top"
    ? `Opens ${formatNotifDate(item.day)}`
    : "Opens the leaderboard";

  return (
    <button
      type="button"
      class={"notif-card tapc" + (item.read ? "" : " notif-card--unread")}
      onClick={onOpen}
    >
      <span
        class="notif-card__tile"
        style={accent ? { color: accent } : undefined}
        aria-hidden="true"
      >
        {item.kind === "lost_top" ? <Crown /> : <Flag />}
      </span>
      <span class="notif-card__body">
        <span class="notif-card__title">{title}</span>
        <span class="notif-card__text">{body}</span>
        {detail && <span class="notif-card__detail mono">{detail}</span>}
        <span class="notif-card__foot">
          <span class="notif-card__link">→ {link}</span>
          <span class="notif-card__ago mono">{formatAgo(item.createdAt)}</span>
        </span>
      </span>
      {!item.read && <span class="notif-card__dot" aria-hidden="true" />}
    </button>
  );
};

// The notifications panel: a bottom sheet on mobile, a right-hand side drawer on
// desktop (purely CSS, adapting the standings sheet's `.standings-modal`). Groups
// unread ("New") above read ("Earlier"); tapping a card marks it read and opens
// the day it's about — its board plus the leaderboard.
export const NotificationsPanel = ({ onClose }: { onClose: () => void }) => {
  const items = notifSignal.value;

  // Refresh on open so the (cached) list is current; stays populated meanwhile.
  useEffect(() => {
    refreshNotifications();
  }, []);

  const { offset, handlers } = useDragToClose(onClose);

  const open = (item: NotificationItem) => {
    if (!item.read) markRead([item.id]);
    // Navigate to the day + board this notification is about (PB for a lost top
    // spot, Daily for a finalized daily) and surface its leaderboard.
    navigateToNotification(item.iteration, item.kind);
    onClose();
  };

  const unread = items.filter((n) => !n.read);
  const read = items.filter((n) => n.read);

  return (
    <div class="notif-modal" onClick={onClose}>
      <div
        class="notif-sheet"
        role="dialog"
        aria-label="Notifications"
        style={offset ? { transform: `translateY(${offset}px)` } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          class="notif-sheet__handle tapc"
          aria-label="Close notifications"
          onClick={onClose}
          {...handlers}
        />
        <div class="notif-sheet__head" {...handlers}>
          <div class="notif-sheet__title">Notifications</div>
          <button
            type="button"
            class="notif-sheet__mark tapc"
            disabled={unread.length === 0}
            onClick={() => markRead()}
          >
            Mark all read
          </button>
        </div>

        <div class="notif-sheet__list">
          {items.length === 0 && (
            <div class="notif-sheet__empty">No notifications yet</div>
          )}
          {unread.length > 0 && (
            <>
              <div class="notif-sheet__section">New</div>
              {unread.map((n) => (
                <Item
                  key={n.id}
                  item={n}
                  onOpen={() => open(n)}
                />
              ))}
            </>
          )}
          {read.length > 0 && (
            <>
              <div class="notif-sheet__section">Earlier</div>
              {read.map((n) => (
                <Item
                  key={n.id}
                  item={n}
                  onOpen={() => open(n)}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
