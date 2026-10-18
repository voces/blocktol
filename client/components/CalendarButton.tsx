import { h } from "preact";
import { useContext } from "preact/compat";
import { newDailyAvailable } from "../store/dailyRollover.ts";
import { GameStateContext } from "./Game/useGameState.ts";
import { t } from "../util/t.ts";

// Mobile-only header icon that opens the full-screen calendar picker (desktop
// shows the calendar inline, so CSS hides this). Hidden mid-daily like the
// calendar. When a new daily is available it shows a persistent pulse + dot
// until the player opens the calendar and switches.
export const CalendarButton = () => {
  const { dailyInProgress, setCalendarOpen } = useContext(GameStateContext);
  // A new daily is waiting to be switched to (rollover, or a past day
  // deep-linked while today's daily is outstanding; see dailyRollover.ts).
  const alert = newDailyAvailable.value;
  // Hidden only mid-run on today's own ranked daily; on a past day the calendar
  // must stay reachable (see dailyInProgress).
  if (dailyInProgress) return null;

  return (
    <button
      type="button"
      class={"cal-button icon-button tapc" +
        (alert ? " cal-button--alert" : "")}
      aria-label={alert ? t("cal.newDaily") : t("cal.open")}
      title={alert ? t("cal.newDaily") : t("cal.previousDays")}
      onClick={() => setCalendarOpen(true)}
    >
      <svg
        width={20}
        height={20}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width={2}
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <rect x={3} y={4.5} width={18} height={16} rx={2.5} />
        <path d="M3 9.5h18" />
        <path d="M8 3v3M16 3v3" />
      </svg>
      {alert && <span class="cal-button__dot" aria-hidden="true" />}
    </button>
  );
};
