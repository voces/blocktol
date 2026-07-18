import { h } from "preact";
import { useContext } from "preact/compat";
import { newDailyAvailable } from "../store/dailyRollover.ts";
import { GameStateContext } from "./Game/useGameState.ts";

// Mobile-only entry point to the calendar: a header icon (next to the profile)
// that opens the full-screen picker. Desktop keeps the calendar inline in the
// left column, so this is hidden there via CSS. Hidden during the daily too —
// like the calendar itself — so there's no wandering to other days mid-run.
// When a new daily has become available (local midnight rolled over), it draws
// attention with a persistent, non-dismissible pulse + dot until the player
// opens the calendar and switches.
export const CalendarButton = () => {
  const { attemptsRemaining, setCalendarOpen } = useContext(GameStateContext);
  const alert = newDailyAvailable.value;
  // Shown once the daily's done or free play begins (attemptsRemaining === 0) —
  // and also once a new daily has rolled in, when the pinned day is over so this
  // (the in-app switch to it) must stay reachable. Otherwise a stale board with
  // attempts still nominally remaining — e.g. a past day deep-linked while
  // today's daily was outstanding — hides it, stranding the player after
  // midnight with no way to switch (see store/dailyRollover.ts).
  if (attemptsRemaining !== 0 && !alert) return null;

  return (
    <button
      type="button"
      class={"cal-button icon-button tapc" +
        (alert ? " cal-button--alert" : "")}
      aria-label={alert ? "New daily available" : "Open calendar"}
      title={alert ? "New daily available" : "Previous days"}
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
