import { h } from "preact";
import { useContext } from "preact/compat";
import { formatPercentile } from "../../../common/formatPercentile.ts";
import { percentileColor } from "../../../common/percentileColor.ts";
import { MessageMap } from "../../api.ts";
import { GameStateContext } from "./useGameState.ts";

type Attempt = MessageMap["getDailySummary"]["attempts"][number];

// When a run happened, from the viewer's clock: relative (Xs/Xm/Xh ago) if it's
// today OR within the last 8 hours — so an 11pm run still reads "3h ago" at 2am —
// otherwise the date.
const formatWhen = (created: number) => {
  const diff = Date.now() - created;
  const when = new Date(created);
  const now = new Date();
  const today = when.getFullYear() === now.getFullYear() &&
    when.getMonth() === now.getMonth() && when.getDate() === now.getDate();

  if (today || diff < 8 * 3_600_000) {
    const s = Math.max(0, Math.floor(diff / 1000));
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    return `${Math.floor(m / 60)}h ago`;
  }
  return when.toLocaleDateString(undefined, { dateStyle: "medium" });
};

// Every run on the viewed maze (ranked and free play, fed by startRun / getBoard
// / getDailySummary via `viewedAttempts`), each tinted to its own percentile
// band. Runs that built the identical maze are merged into one row (×N), best
// first, labelled by when they last ran. The best run carries the BEST — or
// SUPREME, when it tops the field — badge. Clicking a row re-renders that maze.
export const Attempts = () => {
  const { viewedAttempts, viewMaze, freePlay } = useContext(GameStateContext);
  const attempts = viewedAttempts ?? [];

  // Show runs when there's something to show, or when reviewing a board (any
  // past daily or free play sets freePlay — so an unplayed past day still reads
  // "No runs yet"). A fresh, live ranked daily we're just starting — freePlay is
  // false and no attempts yet — renders nothing rather than an empty panel.
  if (attempts.length === 0 && !freePlay) return null;

  // Merge runs with identical maze data (anywhere in the list, not just
  // consecutive), keeping the count and the most recent run.
  const byMaze = new Map<
    string,
    {
      attempt: Attempt;
      count: number;
      latest: number;
      supreme: boolean;
      ranked: boolean;
    }
  >();
  for (const attempt of attempts) {
    const key = JSON.stringify(attempt.maze);
    const group = byMaze.get(key);
    if (group) {
      group.count++;
      group.supreme = group.supreme || attempt.supreme;
      group.ranked = group.ranked || attempt.ranked;
      if (attempt.created > group.latest) {
        group.latest = attempt.created;
        group.attempt = attempt;
      }
    } else {
      byMaze.set(key, {
        attempt,
        count: 1,
        latest: attempt.created,
        supreme: attempt.supreme,
        ranked: attempt.ranked,
      });
    }
  }

  // Best (longest) first; the top row is therefore the BEST/SUPREME one.
  const groups = [...byMaze.values()].sort((a, b) =>
    b.attempt.duration - a.attempt.duration
  );
  const bestIdx = groups.length ? 0 : -1;

  return (
    <div class="attempts">
      <div class="section-title">Runs</div>
      {groups.length
        ? (
          <div class="attempts__list">
            {groups.map((group, i) => {
              const { attempt } = group;
              // Continuous ramp colour (like the calendar); supreme stays gold.
              const band = group.supreme
                ? "var(--gold)"
                : percentileColor(attempt.percent);
              return (
                <div
                  class={"attempts__row attempts__row--clickable tapc" +
                    (group.supreme ? " attempts__row--glow" : "")}
                  key={i}
                  style={{ "--band": band }}
                  title="View this maze"
                  onClick={() => viewMaze(attempt.maze)}
                >
                  <span class="attempts__time mono">{attempt.duration}s</span>
                  <div class="attempts__meta">
                    <div class="attempts__kind">
                      {formatWhen(group.latest)}
                      {group.count > 1 && (
                        <span class="attempts__count">×{group.count}</span>
                      )}
                      {group.ranked && (
                        <span class="attempts__daily">Daily</span>
                      )}
                      {i === bestIdx && (
                        <span class="attempts__badge">
                          {group.supreme ? "SUPREME" : "BEST"}
                        </span>
                      )}
                    </div>
                    <div class="attempts__sub">
                      {formatPercentile(attempt.percent)}%
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
        : <div class="attempts__empty">No runs yet</div>}
    </div>
  );
};
