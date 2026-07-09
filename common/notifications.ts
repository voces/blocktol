// The notification domain, shared by server (generation, storage, push) and
// client (the bell + panel). Kept framework-free — the classification of a
// finalized daily is a pure function so its five-way branch is unit-testable
// without a database, and both sides import the same payload shapes so a stored
// row round-trips with no re-derivation.

export const notificationKinds = ["lost_top", "daily_final"] as const;
export type NotificationKind = (typeof notificationKinds)[number];

// The daily-finalized notification's five faces (see classifyDailyOutcome):
//   placed  — an ordinary finish (#55/2363); compares your time to the day best
//   t1      — TIED best of everyone's first-three attempts, but a free-play
//             build bettered it (still a celebration)
//   first   — the SOLE best of everyone's first-three attempts, bettered only in
//             free play
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

// Someone passed your best build on a day you led — you dropped off the top of
// the PB board. Times are best-build (PB-board) values. (Only a strict pass
// fires; a tie doesn't cost you the top.)
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

// A stored, client-facing notification. The raw recipient id never rides along
// (it's the bearer credential); the payload is fully denormalized at write time
// so a later change to the field can't rewrite history.
export type NotificationOf<K extends NotificationKind> = {
  id: number;
  kind: K;
  iteration: number;
  day: [number, number, number]; // the daily's [year, month, day]
  createdAt: number; // ms epoch
  read: boolean;
  data: NotificationDataOf<K>;
};

export type Notification =
  | NotificationOf<"lost_top">
  | NotificationOf<"daily_final">;

// One player's day, as the outcome classifier reads it: their best ranked daily
// time (null if they never made a ranked attempt) and their best build that day
// (free play included — always defined for anyone with a non-void run).
export type OutcomePlayer = { user: string; daily: number | null; pb: number };

/**
 * Classify a player's finalized daily into a DailyFinalData, or null when they
 * made no ranked attempt (nothing to finalize). Higher time is better.
 *
 * The framing: the ranked board is everyone's best of their first three
 * attempts; free play (the PB board) can then better it. Comparisons are
 * self-excluded — measured against the REST of the field — matching the ratings
 * / profile / calendar convention, so "no one even tied you" means no OTHER
 * player reached your mark in ranked or free play.
 */
export const classifyDailyOutcome = (
  players: readonly OutcomePlayer[],
  user: string,
): DailyFinalData | null => {
  const me = players.find((p) => p.user === user);
  if (!me || me.daily == null) return null;
  const myDaily = me.daily;

  // Standard competition ranking on the ranked board: your rank is 1 + the
  // number of players with a strictly better ranked time (ties share a rank).
  const ranked = players.filter((p) => p.daily != null);
  const field = ranked.length;
  const rank = 1 + ranked.filter((p) => (p.daily as number) > myDaily).length;

  // The rest of the field's extremes.
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

  // Someone out-ranked you → an ordinary finish.
  if (othersTopDaily > myDaily) return { ...base, variant: "placed" };

  // You're (co-)top of the ranked board. Did another player's build better your
  // ranked mark in free play, or merely tie it?
  const buildBeat = othersBestBuild > myDaily;
  const buildTied = othersBestBuild === myDaily;
  const tiedRanked = othersTopDaily === myDaily;

  if (buildBeat) return { ...base, variant: tiedRanked ? "t1" : "first" };
  // No free-play build beat your ranked mark: a record. Sole and untied → supreme.
  if (tiedRanked || buildTied) return { ...base, variant: "record" };
  return { ...base, variant: "supreme" };
};

// ---- shared copy ----

// A daily's calendar day as "Jul 6". Built as a LOCAL date so locale formatting
// can't shift it across midnight (matching the standings sheet's formatter).
export const formatNotifDate = (
  [y, m, d]: readonly [number, number, number],
): string =>
  new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

// Notification times read punchier at one decimal ("21.4s") than the board's two
// — matching the mock — and the comparison is what matters, not the last digit.
export const formatNotifTime = (t: number): string => `${t.toFixed(1)}s`;

// The single source of a notification's headline + one-line body, shared by the
// lock-screen push text and the in-app panel so the two never drift. The panel
// layers icons/colour around the same words (and adds a comparison detail from
// the raw data); the push sends these verbatim.
export const notificationText = (
  n: Pick<Notification, "kind" | "data" | "day">,
): { title: string; body: string } => {
  const date = formatNotifDate(n.day);
  if (n.kind === "lost_top") {
    const d = n.data as LostTopData;
    return {
      title: `You lost #1 on ${date}`,
      body: `${d.passer} passed you. ${formatNotifTime(d.passerTime)} vs your ${
        formatNotifTime(d.yourTime)
      }`,
    };
  }
  const d = n.data as DailyFinalData;
  const of = `of ${d.players}`;
  const body = d.variant === "supreme"
    ? `You finished #1 ${of}. Supreme, untied`
    : d.variant === "record"
    ? `You finished #${d.rank} ${of}. A record held`
    : d.variant === "first"
    ? `You finished #1 ${of}. Bettered only in free play`
    : d.variant === "t1"
    ? `You tied #1 ${of}. Bettered only in free play`
    : `You finished #${d.rank} ${of}`;
  return { title: `${date} daily is final`, body };
};
