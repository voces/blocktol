import { Fragment, h } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/compat";
import { Board } from "../Board.tsx";
import { Button } from "../Button.tsx";
import { Logo } from "../Logo.tsx";
import { decoBlocks, decoCheckpoint } from "../IntroBoard.tsx";
import { formatSeconds } from "../../../common/format.ts";
import { startDailyRun } from "../../store/board.ts";
import { newDailyAvailable, playNewDaily } from "../../store/dailyRollover.ts";
import { requestProfile } from "../../store/notifNav.ts";
import { intlLocale, t } from "../../util/t.ts";
import { GameStateContext } from "./useGameState.ts";

const ATTEMPTS = 3;

// The daily "Start attempt" gate. A ranked attempt opens only from this
// explicit start, so a boot or refresh can't spend one. It blurs a decorative
// copy of the tutorial maze (NOT today's puzzle, so nothing leaks) over the
// board. The button fires `startDailyRun`, which stages the live board and
// leaves this phase.
export const Prestart = () => {
  const { phase, attemptsRemaining, viewedAttempts } = useContext(
    GameStateContext,
  );
  const [starting, setStarting] = useState(false);
  const decoRef = useRef<SVGSVGElement>(null);

  // Stays mounted (rendering null) between attempts, so reset `starting` or
  // the next overlay opens wedged on "Starting…".
  useEffect(() => {
    if (phase !== "prestart") setStarting(false);
  }, [phase]);

  if (phase !== "prestart") return null;

  // `attemptsRemaining` includes the attempt about to start, hence the +1.
  // `completed` is the attempts already spent.
  const attemptNo = Math.min(
    ATTEMPTS,
    Math.max(1, ATTEMPTS - attemptsRemaining + 1),
  );
  const completed = attemptNo - 1;

  // Ranked runs spent so far, oldest first. `diff` is the latest against the
  // one before it (higher is better: a gain is green); none on the first
  // attempt.
  const spent = viewedAttempts
    .filter((a) => a.ranked)
    .sort((a, b) => a.created - b.created);
  const previous = spent[spent.length - 1] ?? null;
  const priorToPrevious = spent[spent.length - 2] ?? null;
  const diff = previous && priorToPrevious
    ? previous.duration - priorToPrevious.duration
    : null;

  const displayDate = new Date().toLocaleDateString(intlLocale(), {
    month: "short",
    day: "numeric",
  });

  const start = () => {
    if (starting) return;
    setStarting(true);
    // On failure or supersession, re-enable for a retry; on success the phase
    // leaves prestart and the effect above resets. `startDailyRun` re-checks a
    // lost answer first, so a retry can't burn a second attempt.
    startDailyRun(completed).then((ok) => {
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
          blocks={decoBlocks}
          checkpoint={decoCheckpoint}
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
            // Parked off today's daily (midnight rolled, or a past day was
            // deep-linked while today's is outstanding): offer it instead of
            // a start. `playNewDaily` re-boots the day.
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
      {
        /* The way to the account controls while the profile button is hidden
           (data export and erasure can't wait on the attempts). Understated so
           it doesn't rival the start button. */
      }
      <button
        type="button"
        class="prestart__account"
        onClick={() => requestProfile("account")}
      >
        {t("prestart.account")}
      </button>
    </div>
  );
};
