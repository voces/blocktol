import { h } from "preact";
import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "preact/compat";
import { api } from "../../api.ts";
import { useApiListener } from "../../hooks/useApiListener.ts";
import { GameStateContext } from "../Game/useGameState.ts";

export const BottomRight = memo(() => {
  const [ownBest, setOwnBest] = useState<number | null>(null);
  const [last, setLast] = useState<number | null>(null);
  const [currentIteration, setCurrentIteration] = useState(-1);
  const { run, time } = useContext(GameStateContext);
  const [duration, setDuration] = useState(0);

  const summary = useApiListener("getDailySummary");
  const rating = summary?.rating;
  const showRating = (summary?.attempts.length ?? 0) < 3;

  useEffect(() => {
    if (!run || time > 0) return;
    setLast(duration);
    if (!ownBest || duration > ownBest) setOwnBest(duration);
  }, [run, time]);

  useApiListener("updateRun", (e) => setDuration(e.duration));

  useApiListener("startRun", (e) => {
    setOwnBest(e.ownBest);
    if (e.iteration !== currentIteration) {
      setLast(null);
      setCurrentIteration(e.iteration);
    }
  });

  // Free play stages a board without a run; track its iteration so the best
  // score (and its tap-to-view) follows the day being played.
  useApiListener("getBoard", (e) => {
    setOwnBest(e.ownBest);
    if (e.iteration !== currentIteration) {
      setLast(null);
      setCurrentIteration(e.iteration);
    }
  });

  useApiListener("getDailySummary", (e) => {
    if (!e.currentRun) return;

    setOwnBest(e.currentRun.ownBest);
    if (e.currentRun.iteration !== currentIteration) {
      setLast(null);
      setCurrentIteration(e.currentRun.iteration);
    }
  });

  const clickHandler = useCallback((e: MouseEvent | TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();

    api.best({ iteration: currentIteration });
  }, [currentIteration]);

  if (typeof rating !== "number") return null;

  return (
    <g
      className="control"
      onMouseDown={showRating ? undefined : clickHandler}
      onTouchStart={showRating ? undefined : clickHandler}
    >
      <text
        x={18.8}
        y={19.75}
        font-size={0.8}
        fill="var(--maze-text)"
        text-anchor="end"
        class="mono"
      >
        {showRating
          ? Math.round(rating)
          : ownBest
          ? `${last ? `${last}s / ` : ""}${ownBest}s`
          : null}
      </text>
      {
        /*
        Transparent hit target covering the bottom-right wall band so the
        best score is reliably tappable on touch devices (SVG text only
        hit-tests on its painted glyphs).
      */
      }
      <rect
        x={11}
        y={19}
        width={9}
        height={1}
        fill="transparent"
        pointer-events="all"
      />
    </g>
  );
});
