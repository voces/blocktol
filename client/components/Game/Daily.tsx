import { ComponentChildren, Fragment, h } from "preact";
import { useContext, useEffect, useState } from "preact/compat";
import { GameStateContext } from "./useGameState.ts";
import { Card } from "../Card.tsx";
import { formatPercentile } from "../../../common/formatPercentile.ts";
import { Button } from "../Button.tsx";

const isTouchEvent = (
  e:
    | h.JSX.TargetedTouchEvent<HTMLDivElement>
    | h.JSX.TargetedMouseEvent<HTMLDivElement>,
): e is h.JSX.TargetedTouchEvent<HTMLDivElement> => e.type === "touchstart";

export const Daily = () => {
  const { attempts } = useContext(GameStateContext);
  const [tooltip, setTooltip] = useState<
    { left: number; top: number; tooltip: ComponentChildren } | null
  >(null);
  const [timeout, setTimeoutId] = useState(-1);

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
          e.currentTarget.parentElement!.innerText.slice(0, -6), // -6 removes "\nShare"
        ], {
          type: "text/plain",
        }),
      }),
    ]);

    const rect = e.currentTarget.parentElement!.parentElement!.parentElement!
      .parentElement!
      .getBoundingClientRect();
    setTooltip({
      left: e.clientX - rect.left - 20,
      top: e.clientY - rect.top,
      tooltip: "Copied!",
    });
    setTimeoutId(setTimeout(() => setTooltip(null), 750));
  };

  if (!attempts) return null;

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
          <div style={{ height: 8 }} />
          <Button style={{ width: "100%" }} onClick={clipboardHandler}>
            Share
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
