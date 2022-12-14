import { h } from "preact";
import { useContext, useEffect, useState } from "preact/compat";
import {
  ListMessage,
  RunMessage,
} from "../../../common/serverToClientMessage.ts";
import { ConnectionContext } from "../../contexts/Connection.ts";

const r0 = 0x00;
const g0 = 0x55;
const b0 = 0xff;

const r1 = 0xff;
const g1 = 0x00;
const b1 = 0x00;

export const DailySelector = () => {
  const connection = useContext(ConnectionContext);
  const [list, setList] = useState<ListMessage["items"]>([]);
  const [selectedIteration, setSelectedIteration] = useState(NaN);

  useEffect(() => {
    const listCallback = (list: ListMessage) => setList(list.items);
    connection.addEventListener("list", listCallback);

    const runCallback = (run: RunMessage) =>
      setList((list): ListMessage["items"] => {
        const row = list.find((row) => row.iteration === run.iteration);
        if (!row) return list;
        if (row.percent === null || row.percent < run.percent) {
          return list.map((row) =>
            row.iteration === run.iteration
              ? ({ ...row, percent: run.percent })
              : row
          );
        }
        return list;
      });
    connection.addEventListener("run", runCallback);

    return () => {
      connection.removeEventListener("list", listCallback);
      connection.removeEventListener("run", runCallback);
    };
  }, []);

  return (
    <div className="daily-selector">
      {list.map((item) => (
        <span
          className={selectedIteration === item.iteration
            ? "selected"
            : undefined}
          title={new Intl.DateTimeFormat(undefined, { dateStyle: "medium" })
            .format(new Date(item.daily[0], item.daily[1] - 1, item.daily[2]))}
          style={{
            backgroundColor: item.percent == null ? "gray" : `#${
              [
                r0 * item.percent + r1 * (1 - item.percent),
                g0 * item.percent + g1 * (1 - item.percent),
                b0 * item.percent + b1 * (1 - item.percent),
              ].map((v) => Math.floor(v).toString(16).padStart(2, "0")).join(
                "",
              )
            }`,
          }}
          onClick={() => {
            setSelectedIteration(item.iteration);
            connection.send({ kind: "play", iteration: item.iteration });
          }}
        >
          <div
            title={`Daily percent: ${
              item.dailyPercent == null
                ? "N/A"
                : Math.floor(item.dailyPercent * 100).toString()
            }`}
            className="daily"
            style={{
              backgroundColor: item.dailyPercent == null ? "gray" : `#${
                [
                  r0 * item.dailyPercent + r1 * (1 - item.dailyPercent),
                  g0 * item.dailyPercent + g1 * (1 - item.dailyPercent),
                  b0 * item.dailyPercent + b1 * (1 - item.dailyPercent),
                ].map((v) => Math.floor(v).toString(16).padStart(2, "0")).join(
                  "",
                )
              }`,
            }}
          />
          {item.percent == null
            ? "-"
            : Math.floor(item.percent * 100).toString()}
        </span>
      ))}
    </div>
  );
};
