// The notification domain, shared by server (generation, storage, push) and
// client (the bell + panel). The classification of a finalized daily is a pure
// function, unit-testable without a database, and both sides share the payload
// shapes.

import { formatSeconds } from "./format.ts";
import { t } from "./i18n.ts";

export const notificationKinds = ["lost_top", "daily_final"] as const;
export type NotificationKind = (typeof notificationKinds)[number];

// The daily-finalized notification's five faces (see classifyDailyOutcome):
//   placed  — an ordinary finish (#55/2363)
//   t1      — TIED best of the ranked board, but a free-play build bettered it
//   first   — the SOLE best of the ranked board, bettered only in free play
//   record  — like t1, but no free-play build beat it (a held record)
//   supreme — like first, but no one even tied you, in ranked OR free play
export const dailyVariants = [
  "placed",
  "t1",
  "first",
  "record",
  "supreme",
] as const;
export type DailyVariant = (typeof dailyVariants)[number];

// Someone passed your best build on a day you led, dropping you off the top of
// the PB board. Times are best-build values. Only a strict pass fires; a tie
// keeps the top.
export type LostTopData = {
  passer: string; // the display name of who passed you
  passerTime: number; // their best build that day — the new top
  yourTime: number; // your best build that day — what got passed
};

// A daily you played has closed and been ranked.
export type DailyFinalData = {
  variant: DailyVariant;
  rank: number; // your rank on the ranked (daily) board — 1 = best
  players: number; // the ranked field size that day
  yourTime: number; // your best ranked daily time
  dayBest: number; // the day's highest build (any run, free play included)
};

export type NotificationDataOf<K extends NotificationKind> = K extends
  "lost_top" ? LostTopData
  : DailyFinalData;

// A stored, client-facing notification. The recipient id never rides along
// (it's the bearer credential); the payload is denormalized at write time so a
// later change to the field can't rewrite history.
export type NotificationOf<K extends NotificationKind> = {
  id: number;
  kind: K;
  iteration: number;
  day: [number, number, number]; // the daily's [year, month, day]
  createdAt: number; // ms epoch
  read: boolean;
  // Computed at read time, never stored: whether a "lost top" has been
  // reclaimed (see `Reclaimed`). The card is struck through but kept. Always
  // null for a daily_final.
  reclaimed: Reclaimed;
  data: NotificationDataOf<K>;
};

// How a reclaimed lost-top holds the top: "solo" = sole best build (gold),
// "tied" = shares it (chartreuse), null = not reclaimed. Mirrors the standings
// record palette.
export type Reclaimed = "solo" | "tied" | null;

export type Notification =
  | NotificationOf<"lost_top">
  | NotificationOf<"daily_final">;

// One player's day for the outcome classifier: best ranked daily time (null
// without a ranked attempt) and best build that day (free play included).
export type OutcomePlayer = { user: string; daily: number | null; pb: number };

/**
 * Classify a player's finalized daily into a DailyFinalData, or null when they
 * made no ranked attempt. Higher time is better.
 *
 * The ranked board is everyone's best of their first three attempts; free play
 * (the PB board) can then better it. Comparisons exclude the player, matching
 * the ratings/profile/calendar convention: "no one even tied you" means no
 * OTHER player reached your mark.
 */
export const classifyDailyOutcome = (
  players: readonly OutcomePlayer[],
  user: string,
): DailyFinalData | null => {
  const me = players.find((p) => p.user === user);
  if (!me || me.daily == null) return null;
  const myDaily = me.daily;

  // Competition ranking: 1 + the players with a strictly better ranked time.
  const ranked = players.filter((p) => p.daily != null);
  const field = ranked.length;
  const rank = 1 + ranked.filter((p) => (p.daily as number) > myDaily).length;

  let othersTopDaily = -Infinity; // best ranked time among others
  let othersBestBuild = -Infinity; // best build among others (free play incl.)
  for (const p of players) {
    if (p.user === user) continue;
    if (p.daily != null && p.daily > othersTopDaily) othersTopDaily = p.daily;
    if (p.pb > othersBestBuild) othersBestBuild = p.pb;
  }

  const dayBest = Math.max(
    me.pb,
    othersBestBuild === -Infinity ? me.pb : othersBestBuild,
  );
  const base = { rank, players: field, yourTime: myDaily, dayBest };

  // Someone out-ranked you.
  if (othersTopDaily > myDaily) return { ...base, variant: "placed" };

  // You're (co-)top of the ranked board. Did another build better or tie your
  // ranked mark in free play?
  const buildBeat = othersBestBuild > myDaily;
  const buildTied = othersBestBuild === myDaily;
  const tiedRanked = othersTopDaily === myDaily;

  if (buildBeat) return { ...base, variant: tiedRanked ? "t1" : "first" };
  // No free-play build beat your mark: a record, or supreme if untied.
  if (tiedRanked || buildTied) return { ...base, variant: "record" };
  return { ...base, variant: "supreme" };
};

// ---- shared copy ----

// A daily's calendar day as "Jul 6". Built as a LOCAL date so locale formatting
// can't shift it across midnight.
export const formatNotifDate = (
  [y, m, d]: readonly [number, number, number],
  locale?: string,
): string =>
  new Date(y, m - 1, d).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
  });

// Notification times use two decimals ("21.43s"), like every time surface; one
// decimal would show a pass decided in the hundredths ("30.34s vs your 30.30s")
// as identical values. `locale` is set for server-rendered push copy.
export const formatNotifTime = (t: number, locale?: string): string =>
  `${formatSeconds(t, { locale })}s`;

// The single source of a notification's headline + one-line body, shared by
// push and the in-app panel so they never drift. The words live in i18n/en.json
// (`notif.*`); this maps a notification to key + params. The panel adds
// icons/colour and a comparison detail; push sends these verbatim. `locale` is
// the recipient's for push, omitted on the client. Variants map to keys by
// literal ternary, never an interpolated key, to keep every key greppable.
export const notificationText = (
  n: Pick<Notification, "kind" | "data" | "day">,
  locale?: string,
): { title: string; body: string } => {
  const date = formatNotifDate(n.day, locale);
  if (n.kind === "lost_top") {
    const d = n.data as LostTopData;
    return {
      title: t(locale, "notif.lostTop.title", { date }),
      body: t(locale, "notif.lostTop.body", {
        passer: d.passer,
        passerTime: formatNotifTime(d.passerTime, locale),
        yourTime: formatNotifTime(d.yourTime, locale),
      }),
    };
  }
  const d = n.data as DailyFinalData;
  const body = d.variant === "supreme"
    ? t(locale, "notif.dailyFinal.supreme", { players: d.players })
    : d.variant === "record"
    ? t(locale, "notif.dailyFinal.record", { players: d.players })
    : d.variant === "first"
    ? t(locale, "notif.dailyFinal.first", { players: d.players })
    : d.variant === "t1"
    ? t(locale, "notif.dailyFinal.t1", { players: d.players })
    : t(locale, "notif.dailyFinal.placed", {
      rank: d.rank,
      players: d.players,
    });
  return { title: t(locale, "notif.dailyFinal.title", { date }), body };
};
