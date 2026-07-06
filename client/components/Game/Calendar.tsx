import { Fragment, h } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/compat";
import { formatPercentile } from "../../../common/formatPercentile.ts";
import {
  percentileColor,
  readableInk,
  SUPREME_COLOR,
} from "../../../common/percentileColor.ts";
import { api } from "../../api.ts";
import { useApiListener } from "../../hooks/useApiListener.ts";
import { DailyItem, useDailyItems } from "../../hooks/useDailyItems.tsx";
import { useMediaQuery } from "../../hooks/useMediaQuery.ts";
import { getTimeZone } from "../../util/timeZone.ts";
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

// Standing (percentile) of a time against the field's best RANKED (daily) time —
// free-play runs are unlimited, so they don't set the ceiling. 0..1, clamped.
const standing = (time: number | null, item: Item) => {
  const top = item.dailyBest ?? item.best;
  if (typeof time !== "number" || typeof top !== "number") return null;
  if (top === item.min) return 1;
  return Math.max(0, Math.min(1, (time - item.min) / (top - item.min)));
};

// Overall standing (best of ranked + free play) drives the cell colour.
const percentOf = (item: Item) => standing(item.ownBest, item);

// Skew toward the top so a strong day stands out among the muted ones.
const cellColor = (item: Item) => {
  if (item.supreme) return SUPREME_COLOR;
  const p = percentOf(item);
  return p == null ? null : percentileColor((p + p ** 4 + p ** 32) / 3);
};

const lastDay = (idx: number) =>
  new Date(Math.floor(idx / 12), (idx % 12) + 1, 0).getDate();

export const Calendar = () => {
  const { items, oldest } = useDailyItems();
  const { freePlay, staged } = useContext(GameStateContext);
  const [selected, setSelected] = useState(NaN);
  // How many whole months back from the default view we've paged (0 = default).
  const [page, setPage] = useState(0);
  // Months (idx = year*12 + month0) we've already asked the server for.
  const requested = useRef(new Set<number>());
  // Bumped when a month fetch fails, to re-run the load effect (e.g. after a
  // brief disconnect on cold load) — the failed month is freed to retry.
  const [retry, setRetry] = useState(0);
  // The very first daily's month — the floor `canPrev` pages back to (from the
  // server, so gaps in the user's own play don't stop paging short of history).
  const oldestIdx = oldest ? oldest[0] * 12 + (oldest[1] - 1) : undefined;

  useApiListener("startRun", (e) => setSelected(e.iteration));
  useApiListener("getBoard", (e) => setSelected(e.iteration));

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
  // Default view: current month, plus the previous month above it when early —
  // desktop only.
  const showPrev = !mobile && td < PREV_MONTH_UNTIL;
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

  // Load each rendered month, plus the one just older so we know whether history
  // continues before the user pages there — once each, via the range API.
  const ensureMonth = (idx: number) => {
    if (idx < 0 || requested.current.has(idx)) return;
    requested.current.add(idx);
    const y = Math.floor(idx / 12);
    const m0 = idx % 12;
    const next = idx + 1;
    api.list({
      start: [y, m0 + 1, 1],
      end: [Math.floor(next / 12), (next % 12) + 1, 1],
    }).catch(() => {
      // Free the month so a later pass retries it (e.g. after a reconnect).
      requested.current.delete(idx);
      setTimeout(() => setRetry((r) => r + 1), 1500);
    });
  };
  const ensureKey = segments.map((s) => s.idx).join(",");
  useEffect(() => {
    for (const s of segments) ensureMonth(s.idx);
    // ensureKey captures exactly the months this render needs; retry re-fires it.
  }, [ensureKey, retry]);

  // Page back until the earliest shown month reaches the first daily ever.
  const canPrev = oldestIdx === undefined || shownEarliest > oldestIdx;
  const canNext = page > 0;

  if (!items.size) return null;

  const byDate = new Map<string, Item>();
  for (const item of items.values()) byDate.set(item.daily.join("-"), item);

  const pick = (item: Item) => {
    if (item.iteration === selected) {
      // Re-clicking the current board's date cancels an in-progress free-play
      // build — re-stage a fresh board. Ranked attempts (and an untouched staged
      // board) are left alone.
      if (freePlay && !staged) {
        api.getBoard({ iteration: item.iteration, timeZone: getTimeZone() });
      }
      return;
    }
    api.getBoard({ iteration: item.iteration, timeZone: getTimeZone() });
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
        <span class="mono">{day}</span>
        {dot != null && (
          <span
            class="calendar__dot"
            style={{ background: percentileColor(dot) }}
          />
        )}
      </div>
    );
  };

  return (
    <div class="calendar">
      <div class="calendar__head">
        <span class="section-title">Previous days</span>
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
      </div>

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
    </div>
  );
};
