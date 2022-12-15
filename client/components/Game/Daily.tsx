import { ComponentChildren, Fragment, h } from "preact";
import { useContext, useEffect, useState } from "preact/compat";
import { GameStateContext } from "./useGameState.ts";
import { Card } from "../Card.tsx";
import { formatPercentile } from "../../../common/formatPercentile.ts";
import { Button } from "../Button.tsx";
import { ConnectionContext } from "../../contexts/Connection.ts";

export const Daily = () => {
  const connection = useContext(ConnectionContext);
  const { attempts, clear } = useContext(GameStateContext);
  const [tooltip, setTooltip] = useState<
    { left: number; top: number; tooltip: ComponentChildren } | null
  >(null);
  const [timeout, setTimeoutId] = useState(-1);
  const [hideDailyResult, setHideDailyResult] = useState(false);

  useEffect(() => () => clearTimeout(timeout), [timeout]);

  const clipboardHandler = (
    e: h.JSX.TargetedMouseEvent<HTMLButtonElement>,
  ) => {
    e.preventDefault();
    e.stopPropagation();

    if (!("clipboard" in navigator)) return;

    navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": new Blob([
          (e.currentTarget.parentElement!.parentElement!
            .firstElementChild as HTMLDivElement)
            .innerText,
        ], {
          type: "text/plain",
        }),
      }),
    ]);

    const rect = e.currentTarget.parentElement!.parentElement!.parentElement!
      .parentElement!.parentElement!
      .getBoundingClientRect();
    setTooltip({
      left: e.clientX - rect.left - 20,
      top: e.clientY - rect.top - 20,
      tooltip: "Copied!",
    });
    setTimeoutId(setTimeout(() => setTooltip(null), 750));
  };

  if (!attempts || hideDailyResult) return null;

  return (
    <>
      <Card
        style={{
          width: 200,
          maxWidth: "100%",
          position: "absolute",
          top: "calc(80px + 20%)",
          left: "50%",
          transform: "translate(-50%, -50%)",
          fontSize: "125%",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div>
          <div style={{ fontWeight: "bold" }}>
            Blocktol {new Date().toLocaleDateString(undefined, {
              dateStyle: "medium",
            })}
          </div>
          {attempts.map(({ duration, percentile }) => (
            <div>{duration}s (p{formatPercentile(percentile)})</div>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Button style={{ width: "100%" }} onClick={clipboardHandler}>
            Share
          </Button>
          <Button
            style={{
              width: "100%",
              backgroundColor: "var(--slow-runner)",
            }}
            onClick={() => {
              connection.send({ kind: "list" });
              clear();
              // connection.send({ kind: "play" });
              setHideDailyResult(true);
            }}
          >
            Keep playing
          </Button>
        </div>
      </Card>
      {tooltip
        ? (
          <div
            style={{
              position: "absolute",
              left: tooltip.left,
              top: tooltip.top,
              color: "white",
              background: "#444d",
              borderRadius: 2,
              padding: "1px 2px",
            }}
          >
            {tooltip.tooltip}
          </div>
        )
        : null}
    </>
  );
};
