import { useApiListener } from "./useApiListener.ts";

export const useIteration = () => {
  const startRunIteration = useApiListener("startRun")?.iteration;
  const dailySummaryIteration = useApiListener("getDailySummary")?.currentRun
    ?.iteration;
  return startRunIteration ?? dailySummaryIteration;
};
