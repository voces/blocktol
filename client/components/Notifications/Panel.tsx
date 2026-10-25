import { Fragment, h } from "preact";
import { useEffect } from "preact/compat";
import {
  type DailyFinalData,
  formatNotifDate,
  formatNotifTime,
  notificationText,
} from "../../../common/notifications.ts";
import type { MessageKey } from "../../../common/i18n.ts";
import { useDragToClose } from "../../hooks/useDragToClose.ts";
import { navigateToNotification } from "../../store/notifNav.ts";
import {
  hideReclaimed as hideReclaimedSignal,
  markRead,
  type NotifFilter,
  notifFilter as filterSignal,
  type NotificationItem,
  notifications as notifSignal,
  refreshNotifications,
  setHideReclaimed,
  setNotifFilter,
} from "../../store/notifications.ts";
import { formatAgo } from "../Standings/helpers.ts";
import { intlLocale, t } from "../../util/t.ts";
import { Check, Crown, Flag } from "./icons.tsx";

// A daily outcome's accent (tile hue and emphasis), mirroring the standings
// record palette: gold for an outright top, chartreuse (--peak) for a shared or
// edged top, none for an ordinary finish.
const dailyAccent = (v: DailyFinalData["variant"]): string | null =>
  v === "supreme" || v === "record"
    ? "var(--gold)"
    : v === "first" || v === "t1"
    ? "var(--peak)"
    : null;

// The filter chips, in display order. Labels are catalog keys resolved at
// render time, held in a literal object so every key stays greppable.
const FILTERS: NotifFilter[] = ["all", "daily_final", "lost_top"];
const CHIP_LABEL_KEY = {
  all: "notif.panel.filter.all",
  daily_final: "notif.panel.filter.daily",
  lost_top: "notif.panel.filter.lostTop",
} as const satisfies Record<NotifFilter, MessageKey>;

// One card. A reclaimed lost-top drops its accent, strikes its title, and
// carries a tag.
const Item = (
  { item, onOpen }: { item: NotificationItem; onOpen: () => void },
) => {
  const { title, body } = notificationText(item, intlLocale());
  const reclaimed = item.reclaimed;
  const accent = reclaimed
    ? null
    : item.kind === "lost_top"
    ? "var(--gold)"
    : dailyAccent((item.data as DailyFinalData).variant);

  // Own time vs the day's best, for a plain daily finish only.
  let detail: string | null = null;
  if (item.kind === "daily_final") {
    const d = item.data as DailyFinalData;
    if (d.variant === "placed") {
      detail = t("notif.panel.detail", {
        yourTime: formatNotifTime(d.yourTime),
        dayBest: formatNotifTime(d.dayBest),
      });
    }
  }

  const link = item.kind === "lost_top"
    ? t("notif.panel.opensDay", {
      date: formatNotifDate(item.day, intlLocale()),
    })
    : t("notif.panel.opensLeaderboard");

  // A reclaimed card is no longer a live nudge, so it never shows as unread.
  const unread = !item.read && !reclaimed;

  return (
    <button
      type="button"
      class={"notif-card tapc" + (unread ? " notif-card--unread" : "") +
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
            {reclaimed === "solo" ? <Crown /> : <Check />}
            {t("notif.panel.reclaimed")}
          </span>
        )}
        <span class="notif-card__foot">
          <span class="notif-card__link">→ {link}</span>
          <span class="notif-card__ago mono">{formatAgo(item.createdAt)}</span>
        </span>
      </span>
      {unread && <span class="notif-card__dot" aria-hidden="true" />}
    </button>
  );
};

// The notifications panel: a bottom sheet on mobile, a side drawer on desktop
// (CSS only, adapting `.standings-modal`). Chips scope the list by kind (and
// can hide reclaimed lost-tops); within the scope, unread ("New") sits above
// read ("Earlier"). Tapping a card marks it read and opens that day's board and
// leaderboard.
export const NotificationsPanel = ({ onClose }: { onClose: () => void }) => {
  const items = notifSignal.value;
  const filter = filterSignal.value;
  const hideR = hideReclaimedSignal.value;

  // Refresh on open; the cached list stays shown meanwhile.
  useEffect(() => {
    refreshNotifications();
  }, []);

  const { offset, handlers } = useDragToClose(onClose);

  const open = (item: NotificationItem) => {
    if (!item.read) markRead([item.id]);
    // Open the day + board it is about (PB for a lost top, Daily for a final).
    navigateToNotification(item.iteration, item.kind);
    onClose();
  };

  // "Hide reclaimed" applies first; chip counts reflect what each would show.
  const anyReclaimed = items.some((n) => n.reclaimed);
  const visible = hideR ? items.filter((n) => !n.reclaimed) : items;
  const countFor = (f: NotifFilter) =>
    f === "all" ? visible.length : visible.filter((n) => n.kind === f).length;

  // Reclaimed cards count as read: they group under Earlier and never gate
  // "Mark all read".
  const shown = visible.filter((n) => filter === "all" || n.kind === filter);
  const unread = shown.filter((n) => !n.read && !n.reclaimed);
  const read = shown.filter((n) => n.read || n.reclaimed);
  const anyUnread = items.some((n) => !n.read && !n.reclaimed);

  const emptyMsg = items.length === 0
    ? t("notif.panel.empty.none")
    : filter === "lost_top"
    ? t("notif.panel.empty.lostTop")
    : filter === "daily_final"
    ? t("notif.panel.empty.daily")
    : t("notif.panel.empty.filtered");

  return (
    <div class="notif-modal" onClick={onClose}>
      <div
        class="notif-sheet"
        role="dialog"
        aria-label={t("notif.bell.title")}
        style={offset ? { transform: `translateY(${offset}px)` } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          class="notif-sheet__handle tapc"
          aria-label={t("notif.panel.close")}
          onClick={onClose}
          {...handlers}
        />
        <div class="notif-sheet__head" {...handlers}>
          <div class="notif-sheet__title">{t("notif.bell.title")}</div>
          <button
            type="button"
            class="notif-sheet__mark tapc"
            disabled={!anyUnread}
            onClick={() => markRead()}
          >
            {t("notif.panel.markAllRead")}
          </button>
        </div>

        {items.length > 0 && (
          <div
            class="notif-sheet__filters"
            role="group"
            aria-label={t("notif.panel.filterGroup")}
          >
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                class="notif-chip tapc"
                aria-pressed={filter === f}
                onClick={() => setNotifFilter(f)}
              >
                {t(CHIP_LABEL_KEY[f])}
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
                {t("notif.panel.hideReclaimed")}
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
              <div class="notif-sheet__section">
                {t("notif.panel.sectionNew")}
              </div>
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
              <div class="notif-sheet__section">
                {t("notif.panel.sectionEarlier")}
              </div>
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
