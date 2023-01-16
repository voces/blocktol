import { h } from "preact";
import { useContext, useEffect, useState } from "preact/compat";
import { formatPercentile } from "../../../common/formatPercentile.ts";
import { api, MessageMap } from "../../api.ts";
import { useApiListener } from "../../hooks/useApiListener.ts";
import { getTimeZone } from "../../util/timeZone.ts";
import { GameStateContext } from "./useGameState.ts";

const r = [253, 251, 208, 100, 82];
const g = [161, 74, 0, 65, 119];
const b = [9, 5, 108, 236, 254];

const getColor = (percent: number) => {
  const l = r.length - 1;
  const i = Math.min(Math.floor(percent * l), l - 1);
  const t = (percent - i / l) * l;
  return `#${
    [
      r[i] + t * (r[i + 1] - r[i]),
      g[i] + t * (g[i + 1] - g[i]),
      b[i] + t * (b[i + 1] - b[i]),
    ].map((v) => Math.floor(v).toString(16).padStart(2, "0")).join("")
  }`;
};

const Daily = (
  { item, selectedIteration, setSelectedIteration }: {
    item: MessageMap["list"]["items"][number];
    selectedIteration: number;
    setSelectedIteration: (selectedIteration: number) => void;
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

  return (
    <span
      className={selectedIteration === item.iteration ? "selected" : undefined}
      title={new Intl.DateTimeFormat(undefined, { dateStyle: "medium" })
        .format(new Date(item.daily[0], item.daily[1] - 1, item.daily[2]))}
      style={{
        backgroundColor: percent == null
          ? "gray"
          : getColor((percent + percent ** 4 + percent ** 32) / 3),
      }}
      onClick={() => {
        setSelectedIteration(item.iteration);
        api.startRun({ iteration: item.iteration, timeZone: getTimeZone() });
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
            : getColor(dailyPercent),
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
          setSelectedIteration={setSelectedIteration}
        />
      ))}
    </div>
  );
};
