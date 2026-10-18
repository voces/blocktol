import { useContext, useEffect } from "preact/compat";
import { GameStateContext } from "./useGameState.ts";

export const useClock = () => {
  const { setTime, staged, deadlineRef } = useContext(GameStateContext);

  useEffect(() => {
    // Staged free play holds the clock still until the first placement.
    if (staged) return;

    // Derive the countdown from the wall-clock deadline, not by decrementing:
    // background-tab intervals throttle and drift while the server's 60s window
    // doesn't. However late a tick fires, the clock lands on the honest value,
    // including 0, which starts the run. Sub-second ticks make the catch-up
    // immediate; an unchanged value bails out of re-rendering.
    const interval = setInterval(
      () =>
        setTime((time) => {
          if (time <= 0) return time;
          const deadline = deadlineRef.current;
          // No deadline yet: hold.
          if (deadline === null) return time;
          return Math.max(0, Math.ceil((deadline - Date.now()) / 1_000));
        }),
      250,
    );

    return () => clearInterval(interval);
  }, [staged]);
};
