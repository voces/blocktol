import { h } from "preact";
import { useContext, useEffect, useState } from "preact/compat";
import { formatPercentile } from "../../../common/formatPercentile.ts";
import {
  ListMessage,
  RunMessage,
} from "../../../common/serverToClientMessage.ts";
import { ConnectionContext } from "../../contexts/Connection.ts";
import { GameStateContext } from "./useGameState.ts";

const r = [253, 251, 208, 100, 82];
const g = [161, 74, 0, 65, 119];
const b = [9, 5, 108, 236, 254];

const getColor = (percent: number) => {
  const p2 = (percent + percent ** 4 + percent ** 32) / 3;
  const l = r.length - 1;
  const i = Math.min(Math.floor(p2 * l), l - 1);
  const t = (p2 - i / l) * l;
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
    item: ListMessage["items"][number];
    selectedIteration: number;
    setSelectedIteration: (selectedIteration: number) => void;
  },
) => {
  const connection = useContext(ConnectionContext);

  const percent =
    typeof item.ownBest === "number" && typeof item.best === "number"
      ? item.ownBest / item.best
      : null;

  const dailyPercent =
    typeof item.ownDailyBest === "number" && typeof item.best === "number"
      ? item.ownDailyBest / item.best
      : null;

  return (
    <span
      className={selectedIteration === item.iteration ? "selected" : undefined}
      title={new Intl.DateTimeFormat(undefined, { dateStyle: "medium" })
        .format(new Date(item.daily[0], item.daily[1] - 1, item.daily[2]))}
      style={{ backgroundColor: percent == null ? "gray" : getColor(percent) }}
      onClick={() => {
        setSelectedIteration(item.iteration);
        connection.send({ kind: "play", iteration: item.iteration });
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
    </span>
  );
};

export const DailySelector = () => {
  const connection = useContext(ConnectionContext);
  const [list, setList] = useState<ListMessage["items"]>([]);
  const [selectedIteration, setSelectedIteration] = useState(NaN);
  const { run, power } = useContext(GameStateContext);

  useEffect(() => {
    const keyDownCallback = (e: KeyboardEvent) => {
      if (e.code !== "KeyR" || (!run && power === -1) || e.metaKey) return;
      if (run) {
        connection.send({ kind: "play", iteration: selectedIteration });
        return;
      }
      connection.send({ kind: "ready" });
    };
    globalThis.addEventListener("keydown", keyDownCallback);

    return () => globalThis.removeEventListener("keydown", keyDownCallback);
  }, [connection, run, power, selectedIteration]);

  useEffect(() => {
    const listCallback = (list: ListMessage) => setList(list.items);
    connection.addEventListener("list", listCallback);

    const runCallback = (run: RunMessage) => {
      setSelectedIteration(run.iteration);
      setList((list): ListMessage["items"] => {
        const row = list.find((row) => row.iteration === run.iteration);
        if (!row) return list;
        if (row.ownBest === null || row.ownBest < run.duration) {
          return list.map((row) =>
            row.iteration === run.iteration
              ? ({
                ...row,
                ownBest: run.duration,
                best: Math.max(row.best ?? -Infinity, run.duration),
              })
              : row
          );
        }
        return list;
      });
    };
    connection.addEventListener("run", runCallback);

    return () => {
      connection.removeEventListener("list", listCallback);
      connection.removeEventListener("run", runCallback);
    };
  }, []);

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
