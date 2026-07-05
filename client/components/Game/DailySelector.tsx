import { h } from "preact";
import { useContext, useEffect, useState } from "preact/compat";
import { formatPercentile } from "../../../common/formatPercentile.ts";
import {
  percentileColor,
  readableInk,
  SUPREME_COLOR,
} from "../../../common/percentileColor.ts";
import { api, MessageMap } from "../../api.ts";
import { useApiListener } from "../../hooks/useApiListener.ts";
import { getTimeZone } from "../../util/timeZone.ts";
import { GameStateContext } from "./useGameState.ts";

const Daily = (
  { item, selectedIteration }: {
    item: MessageMap["list"]["items"][number];
    selectedIteration: number;
  },
) => {
  const percent =
    typeof item.ownBest === "number" && typeof item.best === "number"
      ? item.best === item.min
        ? 1
        : (item.ownBest - item.min) / (item.best - item.min)
      : null;

  const dailyPercent =
    typeof item.ownDailyBest === "number" && typeof item.best === "number"
      ? item.best === item.min
        ? 1
        : (item.ownDailyBest - item.min) / (item.best - item.min)
      : null;

  // Supreme days are gold; otherwise the ramp, skewed toward the top so strong
  // days stand out in the grid.
  const background = item.supreme
    ? SUPREME_COLOR
    : percent == null
    ? "gray"
    : percentileColor((percent + percent ** 4 + percent ** 32) / 3);

  return (
    <span
      className={selectedIteration === item.iteration ? "selected" : undefined}
      title={new Intl.DateTimeFormat(undefined, { dateStyle: "medium" })
        .format(new Date(item.daily[0], item.daily[1] - 1, item.daily[2]))}
      style={{
        backgroundColor: background,
        color: percent == null ? "#fff" : readableInk(background),
      }}
      onClick={() => {
        // Changing days is free play: stage the board (the run opens on the
        // first placement) rather than auto-starting. The selection follows the
        // getBoard response so a locked day (403 until the daily's done) doesn't
        // move it. No-op when it's already the current board.
        if (item.iteration === selectedIteration) return;
        api.getBoard({ iteration: item.iteration, timeZone: getTimeZone() });
      }}
    >
      <div
        title={`Daily percent: ${
          dailyPercent == null
            ? "N/A"
            : Math.floor(dailyPercent * 100).toString()
        }`}
        className="daily"
        style={{
          backgroundColor: dailyPercent == null
            ? "gray"
            : percentileColor(dailyPercent),
        }}
      />
      {percent == null ? "-" : formatPercentile(percent)}
      {item.supreme && "*"}
    </span>
  );
};

export const DailySelector = () => {
  const [list, setList] = useState<MessageMap["list"]["items"]>([]);
  const [selectedIteration, setSelectedIteration] = useState(NaN);
  const data = useApiListener("updateRun");
  const { time } = useContext(GameStateContext);

  useApiListener("startRun", (e) => setSelectedIteration(e.iteration));
  useApiListener("getBoard", (e) => setSelectedIteration(e.iteration));
  useApiListener("list", (data) => setList(data.items));

  useEffect(() => {
    if (time !== 0 || !data) return;

    setList((list) => {
      const row = list.find((row) => row.iteration === selectedIteration);
      if (!row) return list;
      if (row.ownBest === null || row.ownBest < data.duration) {
        return list.map((row) =>
          row.iteration === selectedIteration
            ? ({
              ...row,
              ownBest: data.duration,
              best: Math.max(row.best ?? -Infinity, data.duration),
              supreme: data.supreme || row.supreme,
            })
            : row
        );
      }
      return list;
    });
  }, [time]);

  if (!list.length) return null;

  return (
    <div className="daily-selector">
      {list.map((item) => (
        <Daily
          key={item.iteration}
          item={item}
          selectedIteration={selectedIteration}
        />
      ))}
    </div>
  );
};
