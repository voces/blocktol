import { Fragment, h } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/compat";
import { Board } from "../Board.tsx";
import { Button } from "../Button.tsx";
import { Logo } from "../Logo.tsx";
import { initialBlocks, introCheckpoint } from "../IntroBoard.tsx";
import { formatSeconds } from "../../../common/format.ts";
import { startBoardRun } from "../../store/board.ts";
import { newDailyAvailable, playNewDaily } from "../../store/dailyRollover.ts";
import { t } from "../../util/t.ts";
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
  const { phase, attemptsRemaining, viewedAttempts } = useContext(
    GameStateContext,
  );
  const [starting, setStarting] = useState(false);
  const decoRef = useRef<SVGSVGElement>(null);

  // The component stays mounted (rendering null) between attempts, so a
  // `starting` left true by the previous Start click would stick and wedge the
  // button on "Starting…". Clear it whenever we're not showing the overlay, so
  // the next attempt's overlay opens with a live button.
  useEffect(() => {
    if (phase !== "prestart") setStarting(false);
  }, [phase]);

  if (phase !== "prestart") return null;

  // attemptsRemaining counts the attempt about to be played, so the number is
  // ATTEMPTS - remaining + 1 (clamped for safety). completed = number of
  // attempts already spent.
  const attemptNo = Math.min(
    ATTEMPTS,
    Math.max(1, ATTEMPTS - attemptsRemaining + 1),
  );
  const completed = attemptNo - 1;

  // The attempts spent so far (the panel list carries the finished ranked runs),
  // oldest → newest. "Previous" is the most recent; on the third attempt a diff
  // against the one before it shows the trend — higher time is better, so a gain
  // is green and a drop red. Absent on the first attempt.
  const spent = viewedAttempts
    .filter((a) => a.ranked)
    .sort((a, b) => a.created - b.created);
  const previous = spent[spent.length - 1] ?? null;
  const priorToPrevious = spent[spent.length - 2] ?? null;
  const diff = previous && priorToPrevious
    ? previous.duration - priorToPrevious.duration
    : null;

  const displayDate = new Date().toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  const start = () => {
    if (starting) return;
    setStarting(true);
    // On failure/supersession, re-enable so the player can retry; on success
    // the live board stages (phase leaves prestart) and the reset effect above
    // clears `starting` for the next attempt.
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
        {newDailyAvailable.value
          ? (
            // Parked off today's daily — local midnight rolled a fresh one in,
            // or a past day was deep-linked while today's was still outstanding.
            // Either way offer today's daily instead of a start; switching
            // re-boots the day (playNewDaily) with no manual refresh.
            <Fragment>
              <div class="prestart__eyebrow">
                {t("prestart.eyebrow", { date: displayDate })}
              </div>
              <h2 class="prestart__title">{t("prestart.newDaily.title")}</h2>
              <p class="prestart__sub">
                {t("prestart.newDaily.sub")}
              </p>
              <Button class="prestart__btn" onClick={() => playNewDaily()}>
                {t("prestart.newDaily.play")}
              </Button>
            </Fragment>
          )
          : (
            <Fragment>
              <div class="prestart__eyebrow">
                {t("prestart.eyebrow", { date: displayDate })}
              </div>
              <h2 class="prestart__title">
                {t("prestart.attempt", { n: attemptNo, total: ATTEMPTS })}
              </h2>
              <p class="prestart__sub">{t("prestart.perAttempt")}</p>
              <div class="prestart__dots" aria-hidden="true">
                {Array.from({ length: ATTEMPTS }, (_, i) => (
                  <span
                    key={i}
                    class={"prestart__dot" +
                      (i < completed
                        ? " prestart__dot--done"
                        : i === completed
                        ? " prestart__dot--active"
                        : "")}
                  />
                ))}
              </div>
              {previous && (
                <div class="prestart__prev">
                  {t("prestart.previous")} ·{" "}
                  <span class="mono">
                    {formatSeconds(previous.duration)}s
                  </span>
                  {diff !== null && (
                    <span
                      class={"prestart__diff " +
                        (diff > 0
                          ? "prestart__diff--up"
                          : diff < 0
                          ? "prestart__diff--down"
                          : "prestart__diff--even")}
                    >
                      {diff > 0 ? "+" : diff < 0 ? "−" : "±"}
                      {formatSeconds(Math.abs(diff))}s
                    </span>
                  )}
                </div>
              )}
              <Button
                class="prestart__btn"
                onClick={start}
                disabled={starting}
              >
                {starting ? t("prestart.starting") : t("prestart.start")}
              </Button>
            </Fragment>
          )}
      </div>
    </div>
  );
};
