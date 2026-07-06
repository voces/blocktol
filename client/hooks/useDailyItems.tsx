import { createContext } from "preact";
import { useContext, useState } from "preact/compat";
import { MessageMap } from "../api.ts";
import { useApiListener } from "./useApiListener.ts";

export type DailyItem = MessageMap["list"]["items"][number];
type Attempt = MessageMap["getDailySummary"]["attempts"][number];

export type DailyItemsStore = {
  // The daily list, keyed by iteration and accumulated across paged `list`
  // fetches so paging back never drops already-loaded months.
  items: Map<number, DailyItem>;
  // The first daily's date (paging floor), from the server.
  oldest: [number, number, number] | undefined;
  // Patch a day's item in place from a run's fresh attempts — so finishing a run
  // updates the calendar/today panels without a round trip to refetch the list.
  applyRun: (iteration: number, attempts: readonly Attempt[]) => void;
};

export const DailyItemsContext = createContext<DailyItemsStore>(
  new Proxy({}, {
    get: () => {
      throw new Error("Expected DailyItemsContext provider");
    },
    // deno-lint-ignore no-explicit-any
  }) as any,
);

// The store hook — call once high in the tree (App) and feed it into
// DailyItemsContext.Provider, mirroring how gameState is provided.
export const useDailyItemsStore = (): DailyItemsStore => {
  const [items, setItems] = useState<Map<number, DailyItem>>(new Map());
  const [oldest, setOldest] = useState<[number, number, number]>();

  useApiListener("list", (d) => {
    if (d.oldest) setOldest(d.oldest);
    setItems((prev) => {
      const next = new Map(prev);
      for (const item of d.items) next.set(item.iteration, item);
      return next;
    });
  });

  const applyRun = (iteration: number, attempts: readonly Attempt[]) => {
    // Empty attempts can't set anything authoritatively (they'd wrongly null a
    // day that simply hasn't loaded its runs yet) — the list fetch already has
    // the truth for those.
    if (!attempts.length) return;
    setItems((prev) => {
      const existing = prev.get(iteration);
      // Only patch a day we've actually loaded; an unloaded month will be correct
      // when it's next fetched.
      if (!existing) return prev;

      const ownBest = Math.max(...attempts.map((a) => a.duration));
      const ranked = attempts.filter((a) => a.ranked);
      const bestRanked = ranked.length
        ? ranked.reduce((a, b) => (b.duration > a.duration ? b : a))
        : null;
      const best = attempts.reduce((a, b) => (b.duration > a.duration ? b : a));

      const next = new Map(prev);
      next.set(iteration, {
        ...existing,
        ownBest,
        ownDailyBest: bestRanked ? bestRanked.duration : existing.ownDailyBest,
        best: Math.max(existing.best ?? ownBest, ownBest),
        dailyBest: bestRanked
          ? Math.max(
            existing.dailyBest ?? bestRanked.duration,
            bestRanked.duration,
          )
          : existing.dailyBest,
        supreme: best.supreme,
        dailyPercentile: typeof bestRanked?.percentile === "number"
          ? bestRanked.percentile
          : existing.dailyPercentile,
      });
      return next;
    });
  };

  return { items, oldest, applyRun };
};

export const useDailyItems = () => useContext(DailyItemsContext);
