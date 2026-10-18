import { Fragment, h } from "preact";
import { useContext, useEffect, useState } from "preact/compat";
import { formatPercentile } from "../../../common/formatPercentile.ts";
import {
  PEAK_COLOR,
  percentileColor,
  readableInk,
  standingColor,
  SUPREME_COLOR,
} from "../../../common/percentileColor.ts";
import { standing } from "../../../common/standing.ts";
import { showBoard, showDay } from "../../store/board.ts";
import { newDailyAvailable, playNewDaily } from "../../store/dailyRollover.ts";
import {
  DailyItem,
  dailyItems,
  ensureMonth,
  oldestDaily,
  refreshMonth,
} from "../../store/dailyItems.ts";
import { useMediaQuery } from "../../hooks/useMediaQuery.ts";
import { clearFreePlay } from "./freePlay.ts";
import { intlLocale, t } from "../../util/t.ts";
import { narrowWeekdays } from "../../util/dateNames.ts";
import { GameStateContext } from "./useGameState.ts";

type Item = DailyItem;

// The previous month shows only early in the current one.
const PREV_MONTH_UNTIL = 21;

// The player's best (ranked or free play) against the field's best, through the
// shared `standing`, so it matches the % shown when the day is opened.
const percentOf = (item: Item) =>
  typeof item.ownBest === "number" && typeof item.best === "number"
    ? standing(item.ownBest, item.min, item.best)
    : null;

// The cell colour is the day's standing through `standingColor`, the same
// mapping the runs panel uses, so a cell matches its top run's band.
const cellColor = (item: Item) => {
  if (item.supreme) return SUPREME_COLOR;
  const p = percentOf(item);
  if (p == null) return null;
  // Tied for the field's top without taking the record.
  if (p === 1) return PEAK_COLOR;
  return standingColor(p);
};

const lastDay = (idx: number) =>
  new Date(Math.floor(idx / 12), (idx % 12) + 1, 0).getDate();

export const Calendar = () => {
  // Signals: reading .value subscribes this component to months landing and
  // finished runs patching a day.
  const items = dailyItems.value;
  const oldest = oldestDaily.value;
  const {
    freePlay,
    staged,
    dailyInProgress,
    calendarOpen,
    setCalendarOpen,
    iteration,
  } = useContext(GameStateContext);
  // The loaded board is the selection. Read from game state, it can't drift
  // when the board loader discards a superseded response.
  const selected = iteration;
  // Weekday initials and month/day labels follow the UI locale.
  const locale = intlLocale();
  const weekdays = narrowWeekdays(locale);
  // Whole months paged back from the default view.
  const [page, setPage] = useState(0);
  // The first daily's month, from the server: the floor `canPrev` pages to, so
  // gaps in the player's own history don't stop paging.
  const oldestIdx = oldest ? oldest[0] * 12 + (oldest[1] - 1) : undefined;

  // Mobile shows the previous month only in the open picker (see `showPrev`).
  const mobile = useMediaQuery("(max-width: 1199.98px)");

  const now = new Date();
  const ty = now.getFullYear();
  const tmonth0 = now.getMonth();
  const td = now.getDate();
  const tm = tmonth0 + 1;
  const todayKey = `${ty}-${tm}-${td}`;
  const todayNum = ty * 10000 + tm * 100 + td;

  const currentIdx = ty * 12 + tmonth0;
  // Default view: the current month, plus the previous one early in the month.
  // Inline on desktop and in the mobile picker; not on the mobile board.
  const showPrev = (!mobile || calendarOpen) && td < PREV_MONTH_UNTIL;
  const earliestDefault = currentIdx - (showPrev ? 1 : 0);

  // Segments to render (oldest first): { idx, toDay }.
  const segments: { idx: number; toDay: number }[] = [];
  if (page === 0) {
    if (showPrev) {
      segments.push({ idx: currentIdx - 1, toDay: lastDay(currentIdx - 1) });
      // Current month up to the end of this week (future days shown greyed).
      segments.push({ idx: currentIdx, toDay: td + (6 - now.getDay()) });
    } else {
      // Current month in full, including any fully-future (greyed) weeks.
      segments.push({ idx: currentIdx, toDay: lastDay(currentIdx) });
    }
  } else {
    const idx = earliestDefault - page;
    segments.push({ idx, toDay: lastDay(idx) });
  }

  const shownEarliest = page === 0 ? earliestDefault : earliestDefault - page;

  // The store dedupes and retries (store/dailyItems.ts).
  const ensureKey = segments.map((s) => s.idx).join(",");
  useEffect(() => {
    for (const s of segments) ensureMonth(s.idx);
  }, [ensureKey]);

  // A new player's current-month fetch can land before their first run exists:
  // the server lists only played iterations, so it comes back empty and cached.
  // Refetch once the daily is done.
  useEffect(() => {
    if (dailyInProgress) {
      // Close a stale-open picker so it doesn't reappear when the daily ends.
      setCalendarOpen(false);
      return;
    }
    refreshMonth(currentIdx);
  }, [dailyInProgress]);

  // Page back until the earliest shown month reaches the first daily ever.
  const canPrev = oldestIdx === undefined || shownEarliest > oldestIdx;
  const canNext = page > 0;

  // Hidden only while the ranked daily is in progress (even with attempts
  // spent). Shown otherwise, including on a past day, where it's the way back
  // to the daily.
  if (dailyInProgress) return null;
  // Mobile shows only the picker (opened from the header); desktop ignores
  // `calendarOpen`.
  if (mobile && !calendarOpen) return null;
  if (!items.size) return null;

  const byDate = new Map<string, Item>();
  for (const item of items.values()) byDate.set(item.daily.join("-"), item);

  const pick = (item: Item) => {
    // Dismisses the mobile picker; a no-op on desktop.
    setCalendarOpen(false);
    if (item.iteration === selected) {
      // Re-clicking the current date cancels an in-progress free-play build
      // by re-staging. Ranked attempts and an untouched staged board are left
      // alone. As in the HUD reset, clear the local record FIRST or the
      // re-stage resumes the build being cancelled.
      if (freePlay && !staged) {
        clearFreePlay();
        showBoard(item.iteration);
      }
      return;
    }
    showDay(item.iteration);
  };

  const cell = (year: number, month0: number, day: number) => {
    const key = `${year}-${month0 + 1}-${day}`;
    const item = byDate.get(key);
    const classes = ["calendar__cell"];
    if (key === todayKey) classes.push("calendar__cell--today");

    if (!item) {
      // No daily to replay; future days read fainter than unplayed past ones.
      if (year * 10000 + (month0 + 1) * 100 + day > todayNum) {
        classes.push("calendar__cell--future");
      }
      return (
        <div class={classes.join(" ")} key={key}>
          <span class="mono">{day}</span>
        </div>
      );
    }

    classes.push("calendar__cell--playable");
    if (item.iteration === selected) classes.push("calendar__cell--selected");
    const bg = cellColor(item);
    // The ranked percentile from the server.
    const dot = item.dailyPercentile;
    const percent = percentOf(item);
    // The standing is the hero figure; the day sits in the corner.
    // formatPercentile gains precision near 100 (99.15%), so long strings step
    // down a size to fit.
    const pct = percent != null ? `${formatPercentile(percent)}%` : null;
    const pctClass = "calendar__pct" +
      (pct && pct.length >= 7
        ? " calendar__pct--xlong"
        : pct && pct.length >= 5
        ? " calendar__pct--long"
        : "");
    return (
      <div
        class={classes.join(" ")}
        key={key}
        style={bg ? { background: bg, color: readableInk(bg) } : undefined}
        onClick={() => pick(item)}
        title={[
          new Date(year, month0, day).toLocaleDateString(locale, {
            month: "long",
            day: "numeric",
          }),
          // Cell colour/% is the overall standing; the dot is the ranked
          // percentile (pXX).
          percent != null &&
          t("cal.bestPct", { pct: formatPercentile(percent) }),
          dot != null && t("cal.rankedP", { p: formatPercentile(dot) }),
        ].filter(Boolean).join(" · ")}
      >
        {pct != null
          ? (
            <Fragment>
              <span class="calendar__day">{day}</span>
              <span class={pctClass}>{pct}</span>
            </Fragment>
          )
          : <span class="mono">{day}</span>}
        {dot != null && (
          <span
            class="calendar__dot"
            style={{ background: percentileColor(dot) }}
          />
        )}
      </div>
    );
  };

  // Local midnight passed: a fresh daily is ready. The calendar lists only
  // played days, so this banner is the way there (`playNewDaily` re-boots).
  const newDaily = newDailyAvailable.value
    ? (
      <button
        type="button"
        class="calendar__new-daily tapc"
        onClick={() => playNewDaily()}
      >
        <span class="calendar__new-daily-dot" aria-hidden="true" />
        <span class="calendar__new-daily-text">{t("cal.newDaily")}</span>
        <span class="calendar__new-daily-cta">{t("cal.playCta")}</span>
      </button>
    )
    : null;

  const pager = (
    <div class="calendar__pager">
      <button
        type="button"
        class="calendar__arrow tapc"
        aria-label={t("cal.earlierMonths")}
        disabled={!canPrev}
        onClick={() => setPage((p) => p + 1)}
      >
        ‹
      </button>
      <button
        type="button"
        class="calendar__arrow tapc"
        aria-label={t("cal.laterMonths")}
        disabled={!canNext}
        onClick={() => setPage((p) => Math.max(0, p - 1))}
      >
        ›
      </button>
    </div>
  );

  const grids = (
    <>
      <div class="calendar__grid calendar__grid--weekdays">
        {weekdays.map((wd, i) => (
          <div class="calendar__weekday" key={`wd${i}`}>{wd}</div>
        ))}
      </div>

      {segments.map((seg) => {
        const year = Math.floor(seg.idx / 12);
        const month0 = seg.idx % 12;
        const firstDow = new Date(year, month0, 1).getDay();
        return (
          <Fragment key={seg.idx}>
            <div class="calendar__label">
              {new Date(year, month0).toLocaleDateString(locale, {
                month: "long",
                year: "numeric",
              })}
            </div>
            <div class="calendar__grid">
              {Array.from(
                { length: firstDow },
                (_, i) => <div class="calendar__blank" key={`b${i}`} />,
              )}
              {Array.from(
                { length: seg.toDay },
                (_, i) => cell(year, month0, i + 1),
              )}
            </div>
          </Fragment>
        );
      })}
    </>
  );

  // Mobile: a full-screen picker; the backdrop or a day dismisses it.
  if (mobile) {
    return (
      <div class="calendar-modal" onClick={() => setCalendarOpen(false)}>
        <div
          class="calendar-modal__sheet"
          onClick={(e) => e.stopPropagation()}
        >
          <div class="calendar-modal__header">
            <span class="section-title">{t("cal.previousDays")}</span>
            <div class="calendar-modal__tools">
              {pager}
              <button
                type="button"
                class="calendar-modal__close tapc"
                aria-label={t("cal.close")}
                onClick={() => setCalendarOpen(false)}
              >
                ×
              </button>
            </div>
          </div>
          {newDaily}
          {grids}
        </div>
      </div>
    );
  }

  // Desktop: inline in the left column.
  return (
    <div class="calendar">
      <div class="calendar__head">
        <span class="section-title">{t("cal.previousDays")}</span>
        {pager}
      </div>
      {newDaily}
      {grids}
    </div>
  );
};
