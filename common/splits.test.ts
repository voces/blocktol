import { assertEquals, assertGreater } from "@std/assert";
import { pathDuration } from "./pathing.ts";
import { computeSplits, splitDeltas } from "./splits.ts";
import type { Point } from "./types.ts";

// A straight run up the board: start (9,19) -> checkpoint node (9,9) -> end
// (9,0), in the path's node frame. 19 units at SPEED 5 is 3.8s unslowed.
const PATH: Point[] = [{ x: 9, y: 19 }, { x: 9, y: 9 }, { x: 9, y: 0 }];
// A checkpoint's stored anchor sits half a cell below/left of its node.
const CHECKPOINT = { x: 8.5, y: 8.5 };

Deno.test("splits time the checkpoint and flags along the path", () => {
  const splits = computeSplits({
    path: PATH,
    thunders: [],
    checkpoint: CHECKPOINT,
    // Cell (9,14) sits on the line, 4.5 units in — entered at 0.9s. Cell (2,2)
    // is nowhere near it and never fires.
    flags: [{ x: 9, y: 14 }, { x: 2, y: 2 }],
  });

  assertEquals(splits.map((s) => [s.kind, s.index, s.time]), [
    ["flag", 1, 0.9],
    ["checkpoint", 1, 2],
  ]);
  // The last mark can never exceed the run's own time.
  assertEquals(pathDuration(PATH, []), [3.8, []]);
});

// An out-and-back route: down to a checkpoint at (9,5), then back up past the
// same ground. Anything sitting between the two legs is crossed twice.
const OUT_AND_BACK: Point[] = [{ x: 9, y: 19 }, { x: 9, y: 5 }, {
  x: 9,
  y: 15,
}];
const OUT_AND_BACK_CHECKPOINT = { x: 8.5, y: 4.5 };

Deno.test("a piece keeps its number on every crossing", () => {
  const splits = computeSplits({
    path: OUT_AND_BACK,
    // Off to the side of both legs, and inside its radius long enough for the
    // 3.2s cooldown to expire before the second pass.
    thunders: [{ x: 5, y: 9 }],
    checkpoint: OUT_AND_BACK_CHECKPOINT,
    flags: [{ x: 9, y: 10 }],
  });

  // One flag crossed twice is "Flag 1" both times, and one thunder striking
  // twice is "Slow 1" both times — the number names the piece, not the event.
  // The keys still separate the passes, which is what a delta pairs on.
  assertEquals(
    splits.map((s) => [s.kind, s.index, s.key]),
    [
      ["slow", 1, "s:5,9:1"],
      ["flag", 1, "f:9,10:1"],
      ["checkpoint", 1, "c:8.5,4.5:1"],
      ["slow", 1, "s:5,9:2"],
      ["flag", 1, "f:9,10:2"],
    ],
  );
});

Deno.test("a flag is crossed once per leg", () => {
  // Cell (9,9) is the checkpoint's own node: the runner reaches it, turns, and
  // leaves — one continuous pass, so one mark. Cell (9,4) is only on the second
  // leg.
  const splits = computeSplits({
    path: PATH,
    thunders: [],
    checkpoint: CHECKPOINT,
    flags: [{ x: 9, y: 4 }],
  });
  assertEquals(splits.map((s) => s.kind), ["checkpoint", "flag"]);
  assertEquals(splits[1].key, "f:9,4:1");
});

Deno.test("distinct thunders number in strike order and price their waste", () => {
  // Two thunders 3.5 units off the line, so both trigger. The second lands
  // 2.112s in, while the first's 6s slow still has 4.4s to run — a reset, not a
  // stack, so 4.4s of slow never lands: 2.2s of finish time. The runner then
  // crosses the line with 1.024s of that second slow still owed (another 0.512s
  // of finish time), which folds into the same row: 2.71s in all.
  const thunders = [
    { x: 5, y: 14, local: true },
    { x: 5, y: 10 },
  ];
  const splits = computeSplits({
    path: PATH,
    thunders,
    checkpoint: CHECKPOINT,
  });
  const slows = splits.filter((s) => s.kind === "slow");
  assertEquals(slows.length, 2);
  assertEquals(slows[0].index, 1);
  assertEquals(slows[0].local, true);
  assertEquals(slows[0].wasted, 0);
  assertEquals(slows[1].index, 2);
  assertEquals(slows[1].local, false);
  assertEquals(slows[1].wasted, 2.71);
  // Every mark reads off the same walk the stored time comes from.
  const [duration] = pathDuration(PATH, thunders);
  assertGreater(duration, splits[splits.length - 1].time);
});

Deno.test("deltas pair marks by identity, not by ordinal", () => {
  // Flags belong to the board, so both runs see the same pair — but the
  // straight route only ever crosses (9,14).
  const flags = [{ x: 9, y: 14 }, { x: 7, y: 16 }];
  const best = computeSplits({
    path: PATH,
    thunders: [],
    checkpoint: CHECKPOINT,
    flags,
  });
  // A route that detours out to (6,17) and back, reaching the shared flag later
  // and picking up one the reference never crossed.
  const slower: Point[] = [{ x: 9, y: 19 }, { x: 6, y: 17 }, { x: 9, y: 14 }, {
    x: 9,
    y: 9,
  }, { x: 9, y: 0 }];
  const splits = computeSplits({
    path: slower,
    thunders: [],
    checkpoint: CHECKPOINT,
    flags,
  });
  const deltas = splitDeltas(splits, best);
  const flag = deltas.find((d) => d.key === "f:9,14:1")!;
  assertGreater(flag.delta!, 0);
  const unmatched = deltas.find((d) => d.key === "f:7,16:1")!;
  assertEquals(unmatched.delta, undefined);
});
