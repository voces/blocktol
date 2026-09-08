import { ComponentChildren, h } from "preact";
import { Board } from "./Board.tsx";
import { BrickIcon, PowerIcon } from "./Game/Hud.tsx";
import {
  CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/compat";
import { Point } from "../../common/types.ts";
import { formatSeconds } from "../../common/format.ts";
import { localRun } from "./Game/helpers.ts";
import { runnerTime } from "./Game/interaction.ts";
import { t } from "../util/t.ts";

export const decoBlocks: (Point & {
  local?: boolean;
  thunder?: boolean;
  active?: boolean;
})[] = [
  // opposite of what the WALKTHROUGH wants, which is why the two no longer share
  // a board — see INTRO_FIXED below.
  { x: 17, y: 5 },
  { x: 15, y: 12 },
  { x: 5, y: 3 },
  { x: 3, y: 17 },
  { x: 5, y: 9 },
  { x: 15, y: 17 },
  { x: 7, y: 10 },
  { x: 4, y: 15 },
  { x: 10, y: 15 },
  { x: 12, y: 16 },
  { x: 3, y: 8 },
  { x: 13, y: 10 },
  { x: 9, y: 4 },
  { x: 2, y: 14 },
  { x: 4, y: 11 },
  { x: 4, y: 5 },
  { x: 14, y: 5 },
  { x: 7, y: 14 },
  { x: 17, y: 2 },
  { x: 14, y: 2 },
  { x: 10, y: 1, local: true },
  { x: 8, y: 2, local: true },
  { x: 12, y: 4, local: true },
  { x: 10, y: 6, local: true },
  { x: 6, y: 7, local: true },
  { x: 12, y: 8, local: true },
  { x: 8, y: 16, local: true },
  { x: 6, y: 12, local: true },
  { x: 9, y: 9, local: true },
  { x: 17, y: 7, local: true },
  { x: 16, y: 9, local: true },
  { x: 2, y: 11, local: true },
  { x: 11, y: 12, local: true },
  // Top-left player blocks the refund/move demos act on: the walkthrough removes
  // (2,6) to show a refund and slides (2,4) down a tile to show a move. (3,2) was
  // dropped from the starting maze to clear room for them. The one block the
  // "place" demo adds — (16,14) — is deliberately NOT here: the preloaded maze is
  // the full board minus that single piece, so the walkthrough places exactly one.
  { x: 2, y: 2, local: true },
  { x: 2, y: 6, local: true },
  { x: 2, y: 4, local: true },
];

export const decoCheckpoint: Point = { x: 10.5, y: 4.5 };

// The walkthrough's own maze, and it is chosen, not drawn by hand. The dense
// board above was the tutorial's too, and solving it showed why that was a
// problem: 33 path nodes, an out-and-back through the checkpoint (the runner
// walks a segment, then walks it again backwards), and the right-hand corridor
// travelled three times. A first-time viewer reads that as a runner wandering
// at random — the exact opposite of the point, which is that it takes the
// shortest route it can find and the player can only obstruct it.
//
// So this one was searched for. Its bare route is four nodes and no segment is
// walked twice:
//
//   (9,19) → (9,18) → (4,15) → (10,0)
//
// up a cell, one long diagonal down-left to the checkpoint, one long diagonal
// up-right to the exit — a clear V with a 99° bend. The checkpoint sits three
// cells clear of the nearest walls; a corner also produces a clean route, but a
// corner is an edge case rather than a board the player will meet.
//
// The search's OTHER objective was the drag (see BEATS): a maze where nudging a
// placement one cell visibly changes everything. That is what picked this board
// over the alternatives, now that the clock no longer shows per-block gains.
const INTRO_FIXED: Point[] = [
  { x: 16, y: 8 },
  { x: 10, y: 14 },
  { x: 4, y: 3 },
  { x: 4, y: 6 },
  { x: 12, y: 14 },
  { x: 13, y: 17 },
];

export const introCheckpoint: Point = { x: 3.5, y: 14.5 };

// What the walkthrough itself hands out. Deliberately NOT quoted in the copy:
// a real daily's budget is rolled per iteration (see util/newIteration.ts —
// blocks run 3 to 24, and 70% of days grant no thunder at all), so a tip
// promising "3 blocks" or "1 thunder" would teach a number that is the demo's
// and wrong on the player's very first board. The tips name the chip instead and
// let it do the counting.
const INTRO_BRICKS = 3;
const INTRO_POWER = 1;

type IntroBlock = Point & {
  local?: boolean;
  thunder?: boolean;
  active?: boolean;
};

// The build, one beat per entry, in the order the real gesture happens: place,
// tap to upgrade, tap again to take back, drag to move. That order is not a
// preference — useInputEnd upgrades a tapped block whenever `power > 0` and only
// removes it once there is no thunder left to spend, so a refund demonstrated
// before the thunder would be showing a branch that cannot execute.
//
// The drag is the reason this maze was chosen. (11,16) is placed and does
// NOTHING — the runner ignores it, +0.00s — and nudging it a single cell to
// (10,16) is worth +3.66s and reroutes the run entirely (6 nodes to 10). So the
// beat reads as a placement that isn't working, then working: the drag has a
// purpose rather than being a block sliding across open floor.
//
// The times below are what the maze does, not what the tour displays — the clock
// is the runner's stopwatch and holds through the whole build (see Clock):
//
//   4.60 → 5.25 → 5.25 → 5.68 → 10.28 → 9.85 → 13.51   (2.94x the bare run)
type Beat =
  | { kind: "place"; at: Point }
  | { kind: "refund"; at: Point }
  | { kind: "move"; from: Point; to: Point }
  | { kind: "thunder"; at: Point };

const BEATS: Beat[] = [
  { kind: "place", at: { x: 8, y: 17 } },
  { kind: "place", at: { x: 11, y: 16 } },
  { kind: "place", at: { x: 7, y: 15 } },
  { kind: "thunder", at: { x: 8, y: 17 } },
  { kind: "refund", at: { x: 7, y: 15 } },
  { kind: "move", from: { x: 11, y: 16 }, to: { x: 10, y: 16 } },
];

// How far into BEATS each tip has played by the time you leave it. Steps 0 and 1
// are the opening run and the goal, so they touch nothing; the last tip owns the
// refund AND the drag, and the built run starts under it.
const BEATS_DONE = [0, 0, 3, 4, 6];
const LAST_STEP = 4;
// The drag is the final beat, so the maze is locked the moment it lands — the
// earliest the runner can honestly be released, since a real build is finished
// before the runner goes.
const LAST_BEAT = BEATS.length;

const apply = (blocks: IntroBlock[], beat: Beat): IntroBlock[] => {
  const isAt = (b: IntroBlock, p: Point) =>
    b.x === p.x && b.y === p.y && b.local;
  switch (beat.kind) {
    case "place":
      return [...blocks, { ...beat.at, local: true }];
    case "refund":
      return blocks.filter((b) => !isAt(b, beat.at));
    case "move":
      return blocks.map((b) => isAt(b, beat.from) ? { ...b, ...beat.to } : b);
    case "thunder":
      return blocks.map((b) => isAt(b, beat.at) ? { ...b, thunder: true } : b);
  }
};
const Tooltip = (
  { children, left, right, top, bottom }: {
    children?: ComponentChildren;
    left?: CSSProperties["left"];
    right?: CSSProperties["left"];
    top?: CSSProperties["top"];
    bottom?: CSSProperties["bottom"];
  },
) => (
  <div
    className={"tooltip" +
      // Arrow points up when the tip sits below its target (positioned by top),
      // down otherwise; anchored to the tip's near edge so it can't detach.
      (top !== undefined ? " tooltip--up" : " tooltip--down") +
      (right !== undefined ? " tooltip--right" : "")}
    style={{ top, left, right, bottom }}
  >
    {children}
  </div>
);

const Tip = ({ children, left, right, top, bottom, onSkip, onNext, last }: {
  children?: ComponentChildren;
  left?: CSSProperties["left"];
  right?: CSSProperties["right"];
  top?: CSSProperties["top"];
  bottom?: CSSProperties["bottom"];
  onSkip: () => void;
  onNext: () => void;
  last?: boolean;
}) => (
  <Tooltip
    left={left}
    right={right}
    top={top}
    bottom={bottom}
  >
    {children}
    <div
      style={{
        justifyContent: "right",
        marginTop: 4,
        display: "flex",
        gap: 16,
      }}
    >
      {
        /* Stop the click bubbling to the overlay's own onClick={advance} — the
           whole mask advances on click (tap anywhere to proceed), so without
           this a tap on Skip/Next would fire twice and skip the next tip. */
      }
      {!last && (
        <a
          onClick={(e) => {
            e.stopPropagation();
            onSkip();
          }}
        >
          {t("intro.skip")}
        </a>
      )}
      <a
        onClick={(e) => {
          e.stopPropagation();
          onNext();
        }}
      >
        {last ? t("intro.play") : t("intro.next")}
      </a>
    </div>
  </Tooltip>
);

// The game's own run clock, not a lookalike. `.hud__run` IS the build slot
// "counting the live run up" (styles.css), which is exactly what this is — so
// the tour gets the accent pill, the "seconds" label and the fixed-width digits
// that keep a count-up from jittering, and it sits in `.hud__controls` on the
// RIGHT where the HUD's clock lives. Budgets left, clock right: the tour should
// teach the strip the player is about to use, not a mirror of it.
//
// It is a STOPWATCH, not a readout of the maze: it counts while the runner
// moves, holds while it is paused or stopped, and never derives a number from
// the board. So it says nothing at all during the build — which is also what the
// real game does, where no run time is shown while you are placing. The tour's
// whole "longer is better" argument is therefore carried by two runs, 4.60s and
// 13.51s, rather than by a figure jumping as blocks land.
//
// Holding while paused is free: Runner simply stops publishing, so the last
// value stands. Its own component because that signal is written every frame,
// and reading it up in IntroBoard would re-render Board at that rate.
const Clock = (
  { running, settled }: { running: boolean; settled: number },
) => {
  const live = runnerTime.value;
  return (
    <div class="hud__run">
      <span class="mono">{formatSeconds(running ? live ?? 0 : settled)}</span>
      <span class="hud__build-label">{t("hud.seconds")}</span>
    </div>
  );
};

export const IntroBoard = ({ onDone }: { onDone: () => void }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [step, setStep] = useState(0);
  const [blocks, setBlocks] = useState<IntroBlock[]>(INTRO_FIXED);
  const [beatsDone, setBeatsDone] = useState(0);
  const [run, setRun] = useState<
    {
      path: Point[];
      duration: number;
      slows: { time: number; thunder: Point }[];
    }
  >();
  // The runner is HELD rather than unmounted — for the spawn beat, and for the
  // stop on the checkpoint. Unmounting was how the halt used to be built, and it
  // read as the runner blinking out and reappearing somewhere else rather than
  // stopping on the spot. (Runner handles a hidden tab as a pause of its own.)
  const [paused, setPaused] = useState(true);
  // The last completed run's time. The clock holds it through the build, where
  // the runner isn't moving and so has nothing to say.
  const [settled, setSettled] = useState(0);
  const haltedRef = useRef(false);

  const [placing, setPlacing] = useState<Point & { placing: boolean }>({
    x: 0,
    y: 0,
    placing: false,
  });
  const [transition, setTransition] = useState<IntroBlock | undefined>();
  const [dragMoved, setDragMoved] = useState(false);
  const blocksRef = useRef(blocks);
  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  // The whole tour is timed off the same solver the game validates with, so the
  // clock can never quote a number the runner doesn't then walk.
  const bare = useMemo(() => localRun(INTRO_FIXED, introCheckpoint)!, []);
  // Where the route touches the checkpoint — the node the opening run stops on.
  // The pause there is the entire argument that the checkpoint is compulsory, so
  // it is found by measuring the path rather than hard-coded to an index.
  const cut = useMemo(() => {
    let best = 1, bestD = Infinity;
    bare.path.forEach((p, i) => {
      const d = Math.hypot(p.x - introCheckpoint.x, p.y - introCheckpoint.y);
      if (i > 0 && i < bare.path.length - 1 && d < bestD) {
        [best, bestD] = [i, d];
      }
    });
    return best;
  }, [bare]);

  // Where the halt falls in the walk, as a fraction of the route's length: the
  // clock resumes from there for the second leg. By DISTANCE, not node index —
  // the first leg is a 1.4-unit hop and the second an 8-unit run, so counting
  // nodes would hand the clock a visibly wrong number at the halt. The bare
  // board carries no thunders, so time is proportional to distance.
  const cutFraction = useMemo(() => {
    const seg = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
    let upTo = 0, total = 0;
    for (let i = 1; i < bare.path.length; i++) {
      const d = seg(bare.path[i - 1], bare.path[i]);
      total += d;
      if (i <= cut) upTo += d;
    }
    return total === 0 ? 0 : upTo / total;
  }, [bare, cut]);

  const live = useMemo(() => localRun(blocks, introCheckpoint), [blocks]);
  const duration = live?.duration ?? bare.duration;

  const bricks = Math.max(
    0,
    INTRO_BRICKS - blocks.filter((b) => b.local).length,
  );
  const power = Math.max(
    0,
    INTRO_POWER - blocks.filter((b) => b.thunder).length,
  );

  // Play every beat this tip owns that hasn't run yet — so tapping Next early
  // lands the same board the unhurried reader watched build itself.
  const settle = useCallback((upTo: number) => {
    setBeatsDone((done) => {
      if (done >= upTo) return done;
      setBlocks((bs) => BEATS.slice(done, upTo).reduce(apply, bs));
      return upTo;
    });
  }, []);

  const advance = useCallback(() => {
    // During the opening the tip is up for the whole route, so a click here is
    // "carry on" rather than "next tip": it releases the runner from the stop on
    // the checkpoint, or — if it is still walking — lands the outcome and hands
    // over, the same thing a click does to a half-played build beat.
    if (step === 0) {
      if (paused) {
        setPaused(false);
      } else {
        setRun(undefined);
        setSettled(bare.duration);
        setStep(1);
      }
      return;
    }
    setStep((s) => {
      if (s >= LAST_STEP) return s;
      settle(BEATS_DONE[s]);
      return s + 1;
    });
  }, [step, paused, bare, settle]);

  // The elapsed time at which the runner reaches the checkpoint, by DISTANCE
  // along the route rather than node index — the legs are wildly uneven (a
  // one-cell hop, then two long diagonals), so counting nodes would stop it in
  // the wrong place. The bare board carries no thunders, so time is proportional
  // to distance.
  const haltAt = useMemo(() => {
    const seg = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
    let upTo = 0, total = 0;
    for (let i = 1; i < bare.path.length; i++) {
      const d = seg(bare.path[i - 1], bare.path[i]);
      total += d;
      if (i <= cut) upTo += d;
    }
    return total === 0 ? 0 : bare.duration * (upTo / total);
  }, [bare, cut]);

  // The opening. The runner mounts HELD, so it sits in the start gap long enough
  // to be seen before it moves — otherwise the spawn is on screen for one frame.
  useEffect(() => {
    setRun(bare);
    const timer = setTimeout(() => setPaused(false), 700);
    return () => clearTimeout(timer);
  }, [bare]);

  // The stop on the checkpoint, watched off the runner's own elapsed seconds
  // rather than a timer, so it lands where the runner actually is. Subscribing
  // rather than reading `.value` in render keeps a per-frame signal from
  // re-rendering the board.
  //
  // It then WAITS for the reader. Resuming on a timer meant the tour walked on
  // past the one beat it wants dwelt on — the runner stopping where it has no
  // reason to stop is the whole argument that the checkpoint is compulsory, and
  // an argument you are shown for 900ms and then hurried away from is one you
  // can miss entirely.
  useEffect(() => {
    if (step !== 0) return;
    return runnerTime.subscribe((now) => {
      if (now === undefined || haltedRef.current || now < haltAt) return;
      haltedRef.current = true;
      setPaused(true);
    });
  }, [step, haltAt]);

  // Each build tip plays its beats after a beat's pause, so the tip is read
  // before the board moves under it. Beats land one at a time: three blocks
  // appearing on the same frame reads as one event rather than three.
  useEffect(() => {
    if (step === 0 || step === 1) return;
    const from = BEATS_DONE[step - 1], to = BEATS_DONE[step];
    const timers: number[] = [];
    for (let i = from; i < to; i++) {
      timers.push(setTimeout(() => settle(i + 1), 900 + (i - from) * 450));
    }
    return () => timers.forEach(clearTimeout);
  }, [step, settle]);

  // The move beat is the real drag machinery, not a jump: the block lifts (its
  // origin drawn hidden), the overlay glides to the target, then it lands.
  useEffect(() => {
    const beat = BEATS[LAST_BEAT - 1];
    if (beat.kind !== "move" || beatsDone !== LAST_BEAT) return;
    const mover = blocksRef.current.find((b) =>
      b.x === beat.to.x && b.y === beat.to.y && b.local
    );
    if (!mover) return;
    setTransition({ ...mover, ...beat.from });
    setDragMoved(true);
    setPlacing({ ...beat.from, placing: true });
    const timers = [
      setTimeout(() => setPlacing({ ...beat.to, placing: true }), 400),
      setTimeout(() => {
        setTransition(undefined);
        setDragMoved(false);
        setPlacing({ ...beat.to, placing: false });
      }, 900),
    ];
    return () => timers.forEach(clearTimeout);
  }, [beatsDone]);

  // The built run, released once the last beat has landed AND its drag has
  // finished animating — the maze is locked from that moment, which is the
  // earliest it can honestly go, since a real build is finished before the
  // runner runs. There is no separate finale step and no dead wait: it starts
  // under the tip that was already up.
  useEffect(() => {
    if (beatsDone < LAST_BEAT) return;
    const timer = setTimeout(() => {
      const built = localRun(blocksRef.current, introCheckpoint);
      if (!built) return;
      haltedRef.current = true; // it stops for nothing; the checkpoint is explained
      setSettled(0);
      setRun(built);
      setPaused(false);
    }, 1_200);
    return () => clearTimeout(timer);
  }, [beatsDone]);

  const onFinish = useCallback(() => {
    // The bare run: park its time on the clock and hand over to the goal tip.
    if (step === 0) {
      setRun(undefined);
      setSettled(bare.duration);
      setStep(1);
      return;
    }
    setTimeout(onDone, 1_000); // the built run: that was the tour
  }, [step, bare, onDone]);

  const onSlow = useCallback((thunder: Point) => {
    setBlocks((bs) =>
      bs.map((b) =>
        b.x === thunder.x && b.y === thunder.y ? { ...b, active: true } : b
      )
    );
    setTimeout(
      () =>
        setBlocks((bs) =>
          bs.map((b) =>
            b.x === thunder.x && b.y === thunder.y ? { ...b, active: false } : b
          )
        ),
      100,
    );
  }, []);

  // Anchors are the ARROW's target, in board coordinates: a `left`/`right` of L%
  // puts it at x = L% of the 20-cell board (`right` mirrors it and swings the box
  // leftward, which is what keeps a right-hand target's box on the board), and a
  // `top`/`bottom` does the same vertically, with `bottom` sitting the box ABOVE
  // its target. A block at cell (x, y) spans x/20 … (x+1)/20 across, so each tip
  // below points at the exact piece it is talking about — re-derived for this
  // maze, the way the originals were for theirs.
  const tips: [ComponentChildren, Record<string, unknown>][] = [
    // The checkpoint (cells 4, 15): arrow on its top edge, box above and right.
    [t("intro.tipRoute"), { bottom: "25%", left: "22.5%" }],
    // The clock pill, in the right-hand group above the board.
    [t("intro.tipGoal"), { top: -12, right: 40 }],
    // The topmost placement, (7,15): arrow on its top edge, box above and right,
    // which clears all three — they sit in one cluster along the bottom, and a
    // box tall enough for three lines covers whatever it opens over.
    [t("intro.tipBlocks"), { bottom: "25%", left: "37.5%" }],
    // The block that becomes the thunder, (8,17). Its box opens LEFT and stops
    // at the block's own left edge, so the piece under discussion stays visible.
    [t("intro.tipThunder"), { bottom: "15%", right: "60%" }],
    // The block the refund takes back, (7,15) — named first in the tip, and the
    // one anchor here that leaves every placement on show.
    [t("intro.tipFix"), { bottom: "25%", left: "37.5%" }],
  ];

  return (
    <div class="onboarding">
      {/* Same strip the game builds on: budgets left, clock right. */}
      <div class="hud">
        <div class="hud__chips">
          <div class="hud__chip">
            <BrickIcon />
            <span class="mono">{bricks}</span>
          </div>
          <div class="hud__chip">
            <PowerIcon />
            <span class="mono">{power}</span>
          </div>
        </div>
        <div class="hud__controls">
          <Clock running={!!run} settled={settled} />
        </div>
      </div>
      <Board
        placingBlock={placing}
        touching={false}
        time={-1}
        svgRef={svgRef}
        transitionBlock={transition}
        power={-1}
        thunderHover={undefined}
        blocks={blocks}
        checkpoint={introCheckpoint}
        invalid={false}
        run={run}
        onFinish={onFinish}
        grid={[]}
        onSlow={onSlow}
        date={NaN}
        dragMoved={dragMoved}
        paused={paused}
      />
      <div
        style={{
          width: "min(var(--maze-size), 100%)",
          height: 0,
          paddingBottom: "min(var(--maze-size), 100%)",
          margin: "calc(-1 * min(var(--maze-size), 100%)) auto 0",
          position: "relative",
          fontSize: "calc(min(400px, var(--maze-size)) / 20)",
          filter: "drop-shadow(1px 1px 4px rgba(0, 0, 0, 0.5))",
          backgroundColor: "#0001",
          borderRadius: "var(--radius)",
        }}
        onClick={step < LAST_STEP ? advance : onDone}
      >
        {
          /* The last tip carries only the button — the finale is the runner
            walking the maze the tour built, and narrating that is the habit
            this rewrite is getting rid of. */
        }
        <Tip
          {...tips[step][1]}
          onNext={step < LAST_STEP ? advance : onDone}
          onSkip={onDone}
          last={step === LAST_STEP}
        >
          {tips[step][0]}
        </Tip>
      </div>
    </div>
  );
};
