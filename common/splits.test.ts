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
    // Cell (9,14) is 5 units in: the runner is AT it at 1s (not 0.9s, when it
    // first came within half a cell). Cell (2,2) is off the route.
    flags: [{ x: 9, y: 14 }, { x: 2, y: 2 }],
  });

  assertEquals(splits.map((s) => [s.kind, s.index, s.time]), [
    ["flag", 1, 1],
    ["checkpoint", 1, 2],
  ]);
  // Unslowed duration; no mark can exceed it.
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
    // Beside both legs, in range long enough for the 3.2s cooldown to expire
    // before the second pass.
    thunders: [{ x: 5, y: 9 }],
    checkpoint: OUT_AND_BACK_CHECKPOINT,
    flags: [{ x: 9, y: 10 }],
  });

  // The index names the piece, not the event: one flag crossed twice is "Flag
  // 1" both times. The keys separate the passes, which is what deltas pair on.
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

Deno.test("a flag on the checkpoint reads the checkpoint's time", () => {
  // The checkpoint is timed at its node, a flag at its closest approach; on the
  // same cell those coincide. Timing the flag at its radius's edge would read
  // half a cell early.
  const splits = computeSplits({
    path: PATH,
    thunders: [],
    checkpoint: CHECKPOINT,
    flags: [{ x: 9, y: 9 }],
  });
  assertEquals(splits.map((s) => [s.kind, s.time]), [
    ["checkpoint", 2],
    ["flag", 2],
  ]);
});

Deno.test("a flag is crossed once per leg", () => {
  // Cell (9,9) is the checkpoint's node: the runner turns there, so it is one
  // continuous pass and one mark. Cell (9,4) is only on the second leg.
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
  // 2.112s in while the first's slow has 4.4s left: a reset, so 4.4s of slow
  // (2.2s of finish time) never lands. The runner finishes with 1.024s of the
  // second slow owed (0.512s of finish time), folded into the same row: 2.71s.
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
  // Both runs see the same flags, but the straight route only crosses (9,14).
  const flags = [{ x: 9, y: 14 }, { x: 7, y: 16 }];
  const best = computeSplits({
    path: PATH,
    thunders: [],
    checkpoint: CHECKPOINT,
    flags,
  });
  // Detours out to (6,17): reaches the shared flag later and crosses one the
  // reference never did.
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
