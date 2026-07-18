import { h } from "preact";
import { useContext, useEffect, useState } from "preact/compat";
import { GameStateContext } from "./useGameState.ts";
import { formatSeconds } from "../../../common/format.ts";
import { formatPercentile } from "../../../common/formatPercentile.ts";
import { percentileBand } from "../../../common/percentileColor.ts";
import { useApiListener } from "../../hooks/useApiListener.ts";
import { Button } from "../Button.tsx";
import { Logo } from "../Logo.tsx";
import { showBoard } from "../../store/board.ts";
import { arrivedViaDeepLink } from "../../store/notifNav.ts";
import type { MessageKey } from "../../../common/i18n.ts";
import { t, tJsx } from "../../util/t.ts";

// Best-attempt badge → catalog key, mapped by a literal object so every live
// key stays greppable (see the i18n conventions).
const BADGE_KEY = {
  supreme: "badge.supreme",
  record: "badge.record",
  best: "badge.best",
} as const satisfies Record<"supreme" | "record" | "best", MessageKey>;

const ShareIcon = () => (
  <svg width={15} height={15} viewBox="0 0 16 16">
    <g
      fill="none"
      stroke="#fff"
      stroke-width={1.5}
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <circle cx={12} cy={3.5} r={2} />
      <circle cx={4} cy={8} r={2} />
      <circle cx={12} cy={12.5} r={2} />
      <line x1={5.7} y1={7} x2={10.3} y2={4.5} />
      <line x1={5.7} y1={9} x2={10.3} y2={11.5} />
    </g>
  </svg>
);

// Result glyph, tinted to the banner's --beat color: a check for the top half of
// the field, a dash for the middle, an X for the bottom quartile.
const BEAT_ICON = {
  win: "M3 8.5l3.4 3.4L13 4.2",
  mid: "M4 8h8",
  low: "M4 4l8 8M12 4l-8 8",
};

const BeatIcon = ({ kind }: { kind: keyof typeof BEAT_ICON }) => (
  <svg width={15} height={15} viewBox="0 0 16 16">
    <path
      d={BEAT_ICON[kind]}
      fill="none"
      stroke="var(--beat)"
      stroke-width={1.8}
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
);

export const Daily = () => {
  const { attempts, clear, iteration, staged } = useContext(GameStateContext);
  const stats = useApiListener("getDailySummary")?.stats ?? null;
  const [copied, setCopied] = useState(false);
  const [timeout, setTimeoutId] = useState(-1);
  const [hideDailyResult, setHideDailyResult] = useState(false);

  useEffect(() => () => clearTimeout(timeout), [timeout]);

  // Opened from a day deep-link: stay out of the way of the day/leaderboard it
  // pointed at (the Today panel + standings still carry the numbers).
  if (!attempts || hideDailyResult || arrivedViaDeepLink.value) {
    return null;
  }

  const date = new Date().toLocaleDateString(undefined, {
    dateStyle: "medium",
  });
  // Shorter month + day for the title; the clipboard keeps the full `date`.
  const displayDate = new Date().toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  const attemptLine = (
    { duration, percentile, supreme }: (typeof attempts)[number],
  ) =>
    `${formatSeconds(duration, { min: 0 })}s${
      typeof percentile === "number"
        ? ` (p${formatPercentile(percentile)})`
        : ""
    }${supreme ? "*" : ""}`;

  // The card shows "Blocktol" but the copied text links to the site.
  const shareText = [
    `https://blocktol.com ${date}`,
    ...attempts.map(attemptLine),
  ].join("\n");

  let bestIdx = 0;
  attempts.forEach((a, i) => {
    if (a.duration > attempts[bestIdx].duration) bestIdx = i;
  });
  const best = attempts[bestIdx];
  const isSupreme = best.supreme;
  // A non-supreme run that ties the field's top time gets the peak green-yellow,
  // a step below supreme gold.
  const isPeak = !isSupreme && best.percent === 1;
  const accent = isSupreme
    ? "var(--gold)"
    : isPeak
    ? "var(--peak)"
    : "var(--win)";

  const beatPct = typeof best.percentile === "number"
    ? Math.round(best.percentile * 100)
    : null;
  // Banded theme colour (red → amber → green → blue), supreme in gold, a
  // non-supreme field-topping tie in peak green-yellow — the shared scheme used
  // by the today-result and attempts panels too.
  const beatColor = isSupreme
    ? "var(--gold)"
    : isPeak
    ? "var(--peak)"
    : percentileBand(
      typeof best.percentile === "number" ? best.percentile : null,
    );

  const beatKind: keyof typeof BEAT_ICON =
    isSupreme || (beatPct !== null && beatPct >= 50)
      ? "win"
      : beatPct !== null && beatPct >= 25
      ? "mid"
      : "low";

  const share = (e: h.JSX.TargetedMouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (!("clipboard" in navigator)) return;

    navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": new Blob([shareText], { type: "text/plain" }),
      }),
    ]);

    setCopied(true);
    clearTimeout(timeout);
    setTimeoutId(setTimeout(() => setCopied(false), 1500));
  };

  return (
    <div class="result">
      <div class="result__card">
        <div class="result__header">
          <Logo size={18} />
          <h2 class="result__title">
            {t("daily.resultTitle", { date: displayDate })}
          </h2>
        </div>

        <div class="result__rows">
          {attempts.map((attempt, i) => (
            <div
              key={i}
              class={i === bestIdx
                ? "result__row result__row--best band-card" +
                  (isSupreme ? " result__row--glow" : "")
                : "result__row"}
              style={i === bestIdx ? { "--accent": accent } : undefined}
            >
              <span class="result__label">
                {t("daily.attempt", { n: i + 1 })}
                {i === bestIdx && (
                  <span class="result__badge" style={{ "--badge": accent }}>
                    {t(
                      BADGE_KEY[
                        isSupreme ? "supreme" : isPeak ? "record" : "best"
                      ],
                    )}
                  </span>
                )}
              </span>
              <span class="result__metric">
                {typeof attempt.percentile === "number" && (
                  <span class="result__pct">
                    p{formatPercentile(attempt.percentile)}
                  </span>
                )}
                <span
                  class="result__time mono"
                  style={i === bestIdx ? { color: accent } : undefined}
                >
                  {/* Two decimals, locale-aware, aligned down the column. */}
                  {formatSeconds(attempt.duration)}s
                </span>
              </span>
            </div>
          ))}
        </div>

        {beatPct !== null && (
          <div
            class={isSupreme
              ? "result__banner result__banner--glow"
              : "result__banner"}
            style={{ "--beat": beatColor }}
          >
            <BeatIcon kind={beatKind} />
            <span>
              {tJsx("daily.beat", { pct: <b>{beatPct}%</b> })}
            </span>
          </div>
        )}

        {stats && (
          <div class="result__stats">
            <div class="result__stat">
              <div class="result__stat-value mono">
                {formatSeconds(stats.p25, { min: 0 })}s
              </div>
              <div class="result__stat-label">p25</div>
            </div>
            <div class="result__stat">
              <div class="result__stat-value mono">
                {formatSeconds(stats.median, { min: 0 })}s
              </div>
              <div class="result__stat-label">{t("daily.median")}</div>
            </div>
            <div class="result__stat">
              <div class="result__stat-value mono">
                {formatSeconds(stats.p75, { min: 0 })}s
              </div>
              <div class="result__stat-label">p75</div>
            </div>
          </div>
        )}

        <div class="result__actions">
          <Button class="result__btn" onClick={share}>
            <ShareIcon />
            {copied ? t("daily.copied") : t("daily.share")}
          </Button>
          <Button
            class="result__btn result__btn--keep"
            onClick={() => {
              // The free-play board was already staged in the background when
              // this card opened (see useInit's finished-daily path), so
              // closing usually just closes. The stage-now path is only the
              // fallback for when that fetch failed or hasn't landed yet.
              if (!staged) {
                clear();
                showBoard(iteration);
              }
              setHideDailyResult(true);
            }}
          >
            {t("daily.keepPlaying")}
          </Button>
        </div>
      </div>
    </div>
  );
};
