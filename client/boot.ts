import { primeBoot } from "./api.ts";
import { currentMonthIdx, monthListInput } from "./store/dailyItems.ts";
import { todayIteration } from "./store/standings.ts";
import { getTimeZone } from "./util/timeZone.ts";

// Fire the one cold-boot request and prime every slice off it (see
// api.primeBoot), seeding todayIteration so the dock recognizes the staged board
// as today. The shared entry point for BOTH prime sites:
//
//   - index.ts, at module eval, for a returning (already-onboarded) user; and
//   - App's onboarding `onDone`, for a first-time user (or anyone whose
//     localStorage was cleared / an incognito session) — their module-eval prime
//     was skipped because boot auto-starts the daily's ranked attempt, and that
//     60s clock must not open mid-tutorial. Finishing onboarding IS the moment
//     the app auto-starts the daily anyway, so priming here just overlaps that
//     one request with the re-render into the game instead of fanning out.
//
// `day` is the `/YYYYMMDD` permalink's date (boot bundles that day's board +
// standings too); read from the URL, which is still the entry path at both call
// sites (module eval hasn't rendered yet; onboarding gates syncViewUrl until
// consumeDeepLink, which is itself gated on onboarding being done).
export const primeSession = () => {
  const m = location.pathname.match(/^\/(\d{4})(\d{2})(\d{2})$/);
  const day: [number, number, number] | undefined = m
    ? [Number(m[1]), Number(m[2]), Number(m[3])]
    : undefined;
  const idx = currentMonthIdx();
  return primeBoot(
    { timeZone: getTimeZone(), ...(day ? { day } : {}) },
    [monthListInput(idx), monthListInput(idx - 1)],
  ).then((b) => {
    const s = b?.standings;
    if (s && !("error" in s) && typeof s.iteration === "number") {
      todayIteration.value = s.iteration;
    }
  }).catch(() => {});
};
