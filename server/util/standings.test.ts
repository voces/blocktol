import { assert, assertEquals } from "@std/assert";
import { buildStandings, FieldEntry } from "./standings.ts";

// A descending field where entry N's identity is just its position.
const entry = (i: number, time: number): FieldEntry => ({
  user: `u${i}`,
  name: `p${i}`,
  hue: i,
  time,
  at: i,
});
const fieldOf = (...times: number[]) => times.map((t, i) => entry(i, t));

Deno.test("ranks a strictly-ordered field with podium + neighbourhood", () => {
  // 10 players, viewer 7th (index 6), with a tight window so the podium /
  // neighbourhood / gap mechanics are visible on a small field.
  const field = fieldOf(40, 39, 38, 37, 36, 35, 34, 33, 32, 31);
  const { players, me, rows } = buildStandings(field, "u6", {
    top: 3,
    around: 1,
  });

  assertEquals(players, 10);
  // Percentile is self-excluded (beat 3 of the 9 others).
  assertEquals(me, {
    rank: 7,
    tied: false,
    time: 34,
    record: null,
    percentile: 3 / 9,
  });
  assertEquals(rows.map((r) => r.rank), [1, 2, 3, 6, 7, 8]);
  assertEquals(rows.map((r) => r.you), [
    false,
    false,
    false,
    false,
    true,
    false,
  ]);
  // Exactly one gap, between rank 3 and rank 6: ranks 4 and 5.
  assertEquals(rows.map((r) => r.gapBefore), [0, 0, 0, 2, 0, 0]);
});

Deno.test("competition ranking: ties share a rank, next skips past", () => {
  const field = fieldOf(40, 38, 38, 38, 36);
  const { rows } = buildStandings(field, "u4");

  // Podium (1, T2, T2) plus the viewer's neighbourhood (the third T2, then 5).
  assertEquals(rows.map((r) => r.rank), [1, 2, 2, 2, 5]);
  assertEquals(rows.map((r) => r.tied), [false, true, true, true, false]);
});

Deno.test("viewer inside the podium: no duplicates, window merges", () => {
  const field = fieldOf(40, 39, 38, 37, 36);
  const { rows } = buildStandings(field, "u1", { top: 3, around: 1 });

  assertEquals(rows.map((r) => r.rank), [1, 2, 3]);
  assertEquals(rows.filter((r) => r.you).length, 1);
  assertEquals(rows.every((r) => r.gapBefore === 0), true);
});

Deno.test("viewer absent: me is null, rows are the podium", () => {
  const field = fieldOf(40, 39, 38, 37);
  const { me, rows } = buildStandings(field, "stranger", {
    top: 3,
    around: 1,
  });

  assertEquals(me, null);
  assertEquals(rows.map((r) => r.rank), [1, 2, 3]);
});

Deno.test("viewer last: neighbourhood clamps at the field's end", () => {
  const field = fieldOf(40, 39, 38, 37, 36, 35);
  const { rows } = buildStandings(field, "u5", { top: 3, around: 1 });

  assertEquals(rows.map((r) => r.rank), [1, 2, 3, 5, 6]);
  assertEquals(rows.map((r) => r.gapBefore), [0, 0, 0, 1, 0]);
});

Deno.test("a unique top is 'beat'; a shared top is 'match' for all", () => {
  const unique = buildStandings(fieldOf(40, 39, 38), "u0");
  assertEquals(unique.rows.map((r) => r.record), ["beat", null, null]);

  const shared = buildStandings(fieldOf(40, 40, 38), "u0");
  assertEquals(shared.rows.map((r) => r.record), ["match", "match", null]);
  // A viewer tied at the top still beat everyone below: record + p100.
  assertEquals(shared.me?.record, "match");
  assertEquals(shared.me?.percentile, 1);
});

Deno.test("empty and single-player fields", () => {
  assertEquals(buildStandings([], "u0"), { players: 0, me: null, rows: [] });

  const solo = buildStandings(fieldOf(40), "u0");
  assertEquals(solo.players, 1);
  // Nobody to rank against — no percentile, but the (vacuous) record stands.
  assertEquals(solo.me, {
    rank: 1,
    tied: false,
    time: 40,
    record: "beat",
    percentile: null,
  });
  assertEquals(solo.rows.map((r) => r.record), ["beat"]);
});

Deno.test("rows never carry a user id", () => {
  // The id is the bearer credential; a row leaking it would hand out every
  // ranked player's account. Guarded structurally, not just by types.
  const { rows } = buildStandings(fieldOf(40, 39, 38, 37, 36), "u3");
  assert(rows.length > 0);
  for (const row of rows) {
    assert(!("user" in row), "row must not expose the player's id");
    assertEquals(
      Object.keys(row).sort(),
      [
        "at",
        "gapBefore",
        "hue",
        "name",
        "rank",
        "record",
        "tied",
        "time",
        "you",
      ],
    );
  }
});

Deno.test("default window: whole small fields, a full sheet on big ones", () => {
  // A small field ships entirely — no gaps to render.
  const small = buildStandings(
    fieldOf(...Array.from({ length: 8 }, (_, i) => 40 - i)),
    "u5",
  );
  assertEquals(small.rows.length, 8);
  assertEquals(small.rows.every((r) => r.gapBefore === 0), true);

  // A big field: top 25 plus the viewer's +/-10 neighbourhood, one exact gap.
  const big = buildStandings(
    fieldOf(...Array.from({ length: 200 }, (_, i) => 400 - i)),
    "u149",
  );
  assertEquals(big.rows.length, 25 + 21);
  assertEquals(big.rows[25].rank, 140);
  assertEquals(big.rows[25].gapBefore, 139 - 25);
});
