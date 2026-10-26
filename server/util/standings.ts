// Pure assembly for the standings API: rank a sorted field and slice out the
// display window (the podium plus the viewer's neighbourhood). Split from
// routes/iteration/standings.ts so the tie/window/gap edge cases are testable
// without a database.

export type FieldEntry = {
  // Used only to find the viewer; NEVER emitted in a row (the raw id is the
  // bearer credential; see common/avatar.ts).
  user: string;
  name: string;
  hue: number;
  // The ranked value: the daily-best time on the daily board, the PB on the PB
  // board. Higher is better.
  time: number;
  at: number;
  // The OTHER board's value, shown as the row's small metric line: the PB on
  // the daily board, the day's daily time on the PB board. Absent/null when
  // there is none (a PB-board player with no ranked run that day). Set by
  // `project` in routes/iteration/standings.ts.
  secondary?: number | null;
};

export type StandingsRow = {
  rank: number;
  // Shares its rank with at least one other player (rendered "T2").
  tied: boolean;
  you: boolean;
  name: string;
  hue: number;
  time: number;
  // The small metric line (the other board's value); null when there's none.
  secondary: number | null;
  // When this best was first set (ms epoch), for the row's "2h ago" sub-line.
  at: number;
  // Mirrors the attempts panel's supreme/peak split: a UNIQUE field-best is
  // "beat" (gold); rows tying a SHARED field-best are "match" (lime).
  record: "beat" | "match" | null;
  // Players between this row and the previous displayed one (0 = adjacent), for
  // exact "N between" separators.
  gapBefore: number;
};

// `field` must be sorted best-first (time DESC, at ASC), as `project` in
// routes/iteration/standings.ts produces. Standard competition ranking: tied
// times share a rank and the next distinct time skips (1, 2, 2, 4).
//
// The default window is generous (small fields ship whole, big ones fill a
// desktop sheet); the client renders whatever it gets and gaps stay exact.
export const buildStandings = (
  field: readonly FieldEntry[],
  viewer: string,
  { top = 25, around = 10 } = {},
) => {
  // Each entry with its index, its rank and whether it shares that rank.
  type Ranked = FieldEntry & { index: number; rank: number; tied: boolean };
  const ranked: Ranked[] = [];
  for (const [index, e] of field.entries()) {
    const prev = ranked.at(-1);
    if (prev?.time === e.time) {
      prev.tied = true;
      ranked.push({ ...e, index, rank: prev.rank, tied: true });
    } else {
      ranked.push({ ...e, index, rank: index + 1, tied: false });
    }
  }

  const me = ranked.find((e) => e.user === viewer);

  const top0 = ranked[0];
  const recordOf = (e: Ranked): "beat" | "match" | null =>
    e.time === top0?.time ? (top0.tied ? "match" : "beat") : null;

  // The viewer's self-excluded percentile (ties split, the convention ratings,
  // profile and calendar share), which colours their rank. null when there's
  // nobody to rank against.
  const percentileOf = (time: number) => {
    const others = field.length - 1;
    if (others === 0) return null;
    let less = 0;
    let equal = 0;
    let more = 0;
    for (const e of field) {
      if (e.time < time) less++;
      else if (e.time === time) equal++;
      else more++;
    }
    return more === 0 ? 1 : (less + (equal - 1) / 2) / others;
  };

  // The window: the podium plus the viewer's neighbourhood, in field order.
  const shown = ranked.filter((e) =>
    e.index < top ||
    (me !== undefined && Math.abs(e.index - me.index) <= around)
  );
  let prev = -1;
  const rows = shown.map((e): StandingsRow => {
    const gapBefore = prev < 0 ? 0 : e.index - prev - 1;
    prev = e.index;
    return {
      rank: e.rank,
      tied: e.tied,
      you: e === me,
      name: e.name,
      hue: e.hue,
      time: e.time,
      secondary: e.secondary ?? null,
      at: e.at,
      record: recordOf(e),
      gapBefore,
    };
  });

  return {
    players: field.length,
    me: me === undefined ? null : {
      rank: me.rank,
      tied: me.tied,
      time: me.time,
      secondary: me.secondary ?? null,
      record: recordOf(me),
      percentile: percentileOf(me.time),
    },
    rows,
  };
};
