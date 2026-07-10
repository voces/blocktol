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
  hideReclaimed as hideReclaimedSignal,
  markRead,
  NotifFilter,
  notifFilter as filterSignal,
  NotificationItem,
  notifications as notifSignal,
  refreshNotifications,
  setHideReclaimed,
  setNotifFilter,
} from "../../store/notifications.ts";
import { formatAgo } from "../Standings/helpers.ts";
import { Check, Crown, Flag } from "./icons.tsx";

// A daily outcome's accent — the tile hue and the emphasis colour, mirroring the
// standings record palette: gold for an outright top (supreme / a held record),
// chartreuse (--peak) for a shared/edged top, neutral for an ordinary finish.
const dailyAccent = (v: DailyFinalData["variant"]): string | null =>
  v === "supreme" || v === "record"
    ? "var(--gold)"
    : v === "first" || v === "t1"
    ? "var(--peak)"
    : null;

// The filter chips, in display order.
const FILTERS: NotifFilter[] = ["all", "daily_final", "lost_top"];
const CHIP_LABEL: Record<NotifFilter, string> = {
  all: "All",
  daily_final: "Daily",
  lost_top: "Lost #1",
};

// One card. The tile icon + accent come from the kind/outcome; the title/body
// are the shared copy; a detail line adds the time comparison where it helps. A
// reclaimed lost-top drops its accent, strikes its title, and carries a tag.
const Item = (
  { item, onOpen }: { item: NotificationItem; onOpen: () => void },
) => {
  const { title, body } = notificationText(item);
  const reclaimed = item.reclaimed;
  const accent = reclaimed
    ? null
    : item.kind === "lost_top"
    ? "var(--gold)"
    : dailyAccent((item.data as DailyFinalData).variant);

  // The comparison line: for a plain daily finish, own time vs the day's best;
  // for a lost top, it's already in the body.
  let detail: string | null = null;
  if (item.kind === "daily_final") {
    const d = item.data as DailyFinalData;
    if (d.variant === "placed") {
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
      class={"notif-card tapc" + (item.read ? "" : " notif-card--unread") +
        (reclaimed ? " notif-card--reclaimed" : "")}
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
        {reclaimed && (
          <span class={"notif-card__tag notif-card__tag--" + reclaimed}>
            <Check />
            Reclaimed
          </span>
        )}
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
// desktop (purely CSS, adapting the standings sheet's `.standings-modal`). A
// chip row scopes the list by kind (and can hide reclaimed lost-tops); within
// the scope, unread ("New") sits above read ("Earlier"). Tapping a card marks it
// read and opens the day it's about — its board plus the leaderboard.
export const NotificationsPanel = ({ onClose }: { onClose: () => void }) => {
  const items = notifSignal.value;
  const filter = filterSignal.value;
  const hideR = hideReclaimedSignal.value;

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

  // "Hide reclaimed" drops reclaimed cards; the chips then scope by kind. Counts
  // reflect what each chip would show (so they match the hide toggle).
  const anyReclaimed = items.some((n) => n.reclaimed);
  const visible = hideR ? items.filter((n) => !n.reclaimed) : items;
  const countFor = (f: NotifFilter) =>
    f === "all" ? visible.length : visible.filter((n) => n.kind === f).length;

  const shown = visible.filter((n) => filter === "all" || n.kind === filter);
  const unread = shown.filter((n) => !n.read);
  const read = shown.filter((n) => n.read);
  const anyUnread = items.some((n) => !n.read);

  const emptyMsg = items.length === 0
    ? "No notifications yet"
    : filter === "lost_top"
    ? "No lost-top notifications"
    : filter === "daily_final"
    ? "No daily notifications"
    : "Nothing to show";

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
            disabled={!anyUnread}
            onClick={() => markRead()}
          >
            Mark all read
          </button>
        </div>

        {items.length > 0 && (
          <div
            class="notif-sheet__filters"
            role="group"
            aria-label="Filter notifications"
          >
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                class="notif-chip tapc"
                aria-pressed={filter === f}
                onClick={() => setNotifFilter(f)}
              >
                {CHIP_LABEL[f]}
                <span class="notif-chip__count mono">{countFor(f)}</span>
              </button>
            ))}
            {anyReclaimed && (
              <button
                type="button"
                class="notif-hide tapc"
                aria-pressed={hideR}
                onClick={() => setHideReclaimed(!hideR)}
              >
                Hide reclaimed
              </button>
            )}
          </div>
        )}

        <div class="notif-sheet__list">
          {shown.length === 0 && (
            <div class="notif-sheet__empty">{emptyMsg}</div>
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
