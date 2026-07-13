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
import {
  DailyItem,
  dailyItems,
  ensureMonth,
  oldestDaily,
  refreshMonth,
} from "../../store/dailyItems.ts";
import { useMediaQuery } from "../../hooks/useMediaQuery.ts";
import { clearFreePlay } from "./freePlay.ts";
import { GameStateContext } from "./useGameState.ts";

type Item = DailyItem;

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// Show the previous month in full only when we're early in the current one —
// otherwise the current month is tall enough on its own.
const PREV_MONTH_UNTIL = 21;

// Overall standing (best of ranked + free play) against the field's best
// (anyone, ranked or free play) drives the cell colour — the same shared
// `standing` the runs panel / today-result use, so the calendar's "best %"
// matches the % shown when you open the day.
const percentOf = (item: Item) =>
  typeof item.ownBest === "number" && typeof item.best === "number"
    ? standing(item.ownBest, item.min, item.best)
    : null;

// The cell colour maps the day's best standing through the ramp (via
// standingColor, which curves it so the top end spreads out) — the SAME mapping
// the runs panel uses for that run's band, so a day's cell always matches the
// colour of its top run when opened.
const cellColor = (item: Item) => {
  if (item.supreme) return SUPREME_COLOR;
  const p = percentOf(item);
  if (p == null) return null;
  // Tied for the field's top time without taking the record — peak green-yellow,
  // a step below supreme gold (mirrors the runs/result treatment).
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
    attemptsRemaining,
    calendarOpen,
    setCalendarOpen,
    iteration,
  } = useContext(GameStateContext);
  // The loaded board IS the selection — reading it off game state (rather
  // than mirroring response events) can't drift when a superseded response
  // is discarded by the board loader.
  const selected = iteration;
  // How many whole months back from the default view we've paged (0 = default).
  const [page, setPage] = useState(0);
  // The very first daily's month — the floor `canPrev` pages back to (from the
  // server, so gaps in the user's own play don't stop paging short of history).
  const oldestIdx = oldest ? oldest[0] * 12 + (oldest[1] - 1) : undefined;

  // Mobile keeps it simple: always just the current month. The previous-month
  // rule below is desktop only.
  const mobile = useMediaQuery("(max-width: 1199.98px)");

  const now = new Date();
  const ty = now.getFullYear();
  const tmonth0 = now.getMonth();
  const td = now.getDate();
  const tm = tmonth0 + 1;
  const todayKey = `${ty}-${tm}-${td}`;
  const todayNum = ty * 10000 + tm * 100 + td;

  const currentIdx = ty * 12 + tmonth0;
  // Default view: current month, plus the previous month above it when early in
  // the month (so a short current month isn't marooned). Desktop shows it inline;
  // the mobile full-screen picker does too, to fill the sheet and give context.
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

  // Load each rendered month — the store dedupes and retries (see
  // store/dailyItems.ts), so this just declares what this render needs.
  const ensureKey = segments.map((s) => s.idx).join(",");
  useEffect(() => {
    for (const s of segments) ensureMonth(s.idx);
  }, [ensureKey]);

  // A brand-new user's current-month fetch can land before their first run is
  // recorded — the server bounds the list to iterations they've played, so it
  // comes back empty and gets cached. Once the daily is done (their runs now
  // exist), refetch this month so the calendar fills in.
  useEffect(() => {
    if (attemptsRemaining !== 0) {
      // The daily just (re)started — make sure a stale-open picker doesn't linger
      // to reappear when it ends.
      setCalendarOpen(false);
      return;
    }
    refreshMonth(currentIdx);
  }, [attemptsRemaining]);

  // Page back until the earliest shown month reaches the first daily ever.
  const canPrev = oldestIdx === undefined || shownEarliest > oldestIdx;
  const canNext = page > 0;

  // Hidden while the daily is in progress (even with an attempt or two spent) —
  // no wandering off to other days mid-run. Shown once it's done or during free
  // play (both attemptsRemaining === 0).
  if (attemptsRemaining !== 0) return null;
  // On mobile the calendar is only the full-screen picker (opened from the header
  // button) — nothing inline. Desktop ignores calendarOpen and always shows it.
  if (mobile && !calendarOpen) return null;
  if (!items.size) return null;

  const byDate = new Map<string, Item>();
  for (const item of items.values()) byDate.set(item.daily.join("-"), item);

  const pick = (item: Item) => {
    // Picking a day dismisses the (mobile) picker back to the board; a no-op on
    // desktop where it's never open.
    setCalendarOpen(false);
    if (item.iteration === selected) {
      // Re-clicking the current board's date cancels an in-progress free-play
      // build — re-stage a fresh board. Ranked attempts (and an untouched staged
      // board) are left alone. Same contract as the HUD reset: the local record
      // must go FIRST, or the re-stage would resume the very build being
      // cancelled.
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
      // No daily to replay — future days (not yet run) read fainter than past
      // days that simply weren't played.
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
    // Real ranked percentile from the server (best daily vs others' best daily).
    const dot = item.dailyPercentile;
    const percent = percentOf(item);
    // The standing is the hero figure; the day shrinks into the top-left corner.
    // formatPercentile keeps growing precision as it nears 100 (98% but 99.15%),
    // so long near-100 strings step down a size to still fit the cell.
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
          `${MONTHS[month0]} ${day}`,
          // Cell is the overall best as a percentage of the way to the field's
          // best — XX%; the dot is the ranked (daily) percentile — pXX.
          percent != null && `best ${formatPercentile(percent)}%`,
          dot != null && `ranked p${formatPercentile(dot)}`,
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

  const pager = (
    <div class="calendar__pager">
      <button
        type="button"
        class="calendar__arrow tapc"
        aria-label="Earlier months"
        disabled={!canPrev}
        onClick={() => setPage((p) => p + 1)}
      >
        ‹
      </button>
      <button
        type="button"
        class="calendar__arrow tapc"
        aria-label="Later months"
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
        {WEEKDAYS.map((wd, i) => (
          <div class="calendar__weekday" key={`wd${i}`}>{wd}</div>
        ))}
      </div>

      {segments.map((seg) => {
        const year = Math.floor(seg.idx / 12);
        const month0 = seg.idx % 12;
        const firstDow = new Date(year, month0, 1).getDay();
        return (
          <Fragment key={seg.idx}>
            <div class="calendar__label">{MONTHS[month0]} {year}</div>
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

  // Mobile: a full-screen picker over the board — one header row (title, pager,
  // close), grids anchored to the top. Tap the backdrop or a day to dismiss.
  if (mobile) {
    return (
      <div class="calendar-modal" onClick={() => setCalendarOpen(false)}>
        <div
          class="calendar-modal__sheet"
          onClick={(e) => e.stopPropagation()}
        >
          <div class="calendar-modal__header">
            <span class="section-title">Previous days</span>
            <div class="calendar-modal__tools">
              {pager}
              <button
                type="button"
                class="calendar-modal__close tapc"
                aria-label="Close calendar"
                onClick={() => setCalendarOpen(false)}
              >
                ×
              </button>
            </div>
          </div>
          {grids}
        </div>
      </div>
    );
  }

  // Desktop: inline in the left column.
  return (
    <div class="calendar">
      <div class="calendar__head">
        <span class="section-title">Previous days</span>
        {pager}
      </div>
      {grids}
    </div>
  );
};
