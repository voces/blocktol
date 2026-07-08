// Pure assembly for the standings API: rank a sorted field and slice out the
// display window (the podium plus the viewer's neighbourhood). Split from the
// route so the tie/window/gap edge cases are unit-testable without a database.

export type FieldEntry = {
  // The player's id — used only to find the viewer; NEVER emitted in a row
  // (the raw id is the bearer credential; see common/avatar.ts).
  user: string;
  name: string;
  hue: number;
  time: number;
  at: number;
};

export type StandingsRow = {
  rank: number;
  // Shares its rank with at least one other player (rendered "T2").
  tied: boolean;
  you: boolean;
  name: string;
  hue: number;
  time: number;
  // When this best was first set (ms epoch) — the row's "2h ago" sub-line.
  at: number;
  // The field's record states, mirroring the attempts panel's supreme/peak
  // split: a UNIQUE field-best is "beat" (gold, crowned); rows tying a SHARED
  // field-best are "match" (lime). null for everyone else.
  record: "beat" | "match" | null;
  // Players between this row and the previously displayed one (0 = adjacent),
  // so the client renders exact "N between" separators without knowing the
  // full field.
  gapBefore: number;
};

// `field` must be sorted best-first (time DESC, at ASC — getDailyStandings'
// order). Standard competition ranking: tied times share a rank and the next
// distinct time skips past them (1, 2, 2, 4).
export const buildStandings = (
  field: readonly FieldEntry[],
  viewer: string,
  { top = 3, around = 1 } = {},
) => {
  const ranks: number[] = [];
  for (let i = 0; i < field.length; i++) {
    ranks.push(
      i > 0 && field[i].time === field[i - 1].time ? ranks[i - 1] : i + 1,
    );
  }
  const tiedAt = (i: number) =>
    (i > 0 && field[i - 1].time === field[i].time) ||
    (i + 1 < field.length && field[i + 1].time === field[i].time);

  const meIdx = field.findIndex((e) => e.user === viewer);

  // The window: the podium ∪ the viewer's neighbourhood, deduped via a set of
  // indices. A viewer inside the podium simply widens nothing.
  const indices = new Set<number>();
  for (let i = 0; i < Math.min(top, field.length); i++) indices.add(i);
  if (meIdx >= 0) {
    const from = Math.max(0, meIdx - around);
    const to = Math.min(field.length - 1, meIdx + around);
    for (let i = from; i <= to; i++) indices.add(i);
  }

  const topTime = field[0]?.time;
  const topShared = field.length > 1 && field[1].time === topTime;
  const recordOf = (i: number): "beat" | "match" | null =>
    field[i].time === topTime ? (topShared ? "match" : "beat") : null;

  // The viewer's self-excluded ranked percentile (how much of the field they
  // beat, ties split — the convention ratings/profile/calendar share), used
  // to colour their rank on the percentile ramp. null when there's nobody to
  // rank against.
  const percentileOf = (i: number) => {
    const others = field.length - 1;
    if (others === 0) return null;
    let less = 0;
    let equal = 0;
    let more = 0;
    for (const e of field) {
      if (e.time < field[i].time) less++;
      else if (e.time === field[i].time) equal++;
      else more++;
    }
    return more === 0 ? 1 : (less + (equal - 1) / 2) / others;
  };

  let prev = -1;
  const rows = [...indices].sort((a, b) => a - b).map((i): StandingsRow => {
    const gapBefore = prev < 0 ? 0 : i - prev - 1;
    prev = i;
    return {
      rank: ranks[i],
      tied: tiedAt(i),
      you: i === meIdx,
      name: field[i].name,
      hue: field[i].hue,
      time: field[i].time,
      at: field[i].at,
      record: recordOf(i),
      gapBefore,
    };
  });

  return {
    players: field.length,
    me: meIdx < 0 ? null : {
      rank: ranks[meIdx],
      tied: tiedAt(meIdx),
      time: field[meIdx].time,
      record: recordOf(meIdx),
      percentile: percentileOf(meIdx),
    },
    rows,
  };
};
