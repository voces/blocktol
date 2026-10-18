import { primeBoot } from "./api.ts";
import { currentMonthIdx, monthListInput } from "./store/dailyItems.ts";
import { todayIteration } from "./store/standings.ts";
import { getTimeZone } from "./util/timeZone.ts";

// Fire the one cold-boot request and prime every slice off it (see
// api.primeBoot), seeding todayIteration so the dock recognizes the staged board
// as today. Called from both prime sites:
//
//   - index.ts, at module eval, for an already-onboarded user; and
//   - App's onboarding `onDone`, for a first-time user, whose module-eval prime
//     is skipped because it would expire (PRIME_TTL_MS) during the tutorial.
//
// `day` is the `/YYYYMMDD` permalink's date (boot bundles that day's board and
// standings too). The URL is still the entry path at both call sites:
// onboarding gates syncViewUrl until consumeDeepLink, which is itself gated on
// onboarding being done.
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
