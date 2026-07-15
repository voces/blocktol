import { h } from "preact";
import { useContext, useRef, useState } from "preact/compat";
import { Board } from "../Board.tsx";
import { Button } from "../Button.tsx";
import { Logo } from "../Logo.tsx";
import { initialBlocks, introCheckpoint } from "../IntroBoard.tsx";
import { startBoardRun } from "../../store/board.ts";
import { GameStateContext } from "./useGameState.ts";

const ATTEMPTS = 3;

// The daily "Start attempt" gate. A ranked attempt no longer opens on load —
// the player starts it explicitly here, so a background boot or refresh can't
// silently spend one. Covers the board with a blur mask (themed for light and
// dark) over a decorative, blurred copy of the tutorial maze — a real-looking
// backdrop that is deliberately NOT today's puzzle, so nothing leaks. The
// button fires `startBoardRun("daily")` (the one fetch-and-start call), which
// stages the live board and drops us out of this phase.
export const Prestart = () => {
  const { phase, attemptsRemaining } = useContext(GameStateContext);
  const [starting, setStarting] = useState(false);
  const decoRef = useRef<SVGSVGElement>(null);

  if (phase !== "prestart") return null;

  // attemptsRemaining counts the attempt about to be played, so the number is
  // ATTEMPTS - remaining + 1 (clamped for safety).
  const attemptNo = Math.min(
    ATTEMPTS,
    Math.max(1, ATTEMPTS - attemptsRemaining + 1),
  );
  const displayDate = new Date().toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  const start = () => {
    if (starting) return;
    setStarting(true);
    // On failure/supersession, re-enable so the player can retry; on success
    // the live board stages (phase leaves prestart) and this unmounts.
    startBoardRun("daily").then((ok) => {
      if (!ok) setStarting(false);
    });
  };

  return (
    <div class="prestart">
      <div class="prestart__deco" aria-hidden="true">
        <Board
          placingBlock={{ x: 0, y: 0, placing: false }}
          touching={false}
          time={-1}
          svgRef={decoRef}
          transitionBlock={undefined}
          power={-1}
          thunderHover={undefined}
          blocks={initialBlocks}
          checkpoint={introCheckpoint}
          invalid={false}
          run={undefined}
          onFinish={() => {}}
          grid={[]}
          onSlow={() => {}}
          date={NaN}
          dragMoved={false}
        />
      </div>
      <div class="prestart__content">
        <Logo size={44} />
        <div class="prestart__eyebrow">Daily · {displayDate}</div>
        <h2 class="prestart__title">Attempt {attemptNo} of {ATTEMPTS}</h2>
        <p class="prestart__sub">You'll have 60 seconds per attempt.</p>
        <div class="prestart__dots" aria-hidden="true">
          {Array.from({ length: ATTEMPTS }, (_, i) => (
            <span
              key={i}
              class={"prestart__dot" +
                (i < attemptNo - 1
                  ? " prestart__dot--done"
                  : i === attemptNo - 1
                  ? " prestart__dot--active"
                  : "")}
            />
          ))}
        </div>
        <Button
          class="prestart__btn"
          onClick={start}
          disabled={starting}
        >
          {starting ? "Starting…" : "Start attempt"}
        </Button>
      </div>
    </div>
  );
};
