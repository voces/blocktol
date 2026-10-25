import { type ComponentChildren, h } from "preact";
import { Board } from "./Board.tsx";
import { BrickIcon, PowerIcon } from "./Game/Hud.tsx";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/compat";
import { type Point } from "../../common/types.ts";
import { formatSeconds } from "../../common/format.ts";
import { localRun } from "./Game/helpers.ts";
import { runnerTime } from "./Game/interaction.ts";
import { t } from "../util/t.ts";

export const decoBlocks: (Point & {
  local?: boolean;
  thunder?: boolean;
  active?: boolean;
})[] = [
  // The pre-start overlay's backdrop (Game/Prestart.tsx): a dense maze, too
  // busy for the walkthrough, which has its own board (see INTRO_FIXED).
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
  // Player (local) blocks in the top-left corner of the backdrop.
  { x: 2, y: 2, local: true },
  { x: 2, y: 6, local: true },
  { x: 2, y: 4, local: true },
];

export const decoCheckpoint: Point = { x: 10.5, y: 4.5 };

// The walkthrough's maze, searched for rather than drawn. The dense backdrop
// above is a bad tutorial board: its route is 33 nodes with an out-and-back
// through the checkpoint, which reads as a runner wandering at random instead
// of taking the shortest route. This board's bare route is four nodes with no
// segment walked twice:
//
//   (9,19) → (9,18) → (4,15) → (10,0)
//
// a clear V with a 99° bend, the checkpoint three cells clear of the walls (a
// corner checkpoint is an edge case, not a typical board). The search's other
// objective was the drag (see BEATS): nudging a placement one cell must change
// the route visibly, since the clock doesn't show per-block gains.
const INTRO_FIXED: Point[] = [
  { x: 16, y: 8 },
  { x: 10, y: 14 },
  { x: 4, y: 3 },
  { x: 4, y: 6 },
  { x: 12, y: 14 },
  { x: 13, y: 17 },
];

export const introCheckpoint: Point = { x: 3.5, y: 14.5 };

// What the walkthrough hands out. Never quote these in the copy: a real daily's
// budget is rolled per iteration (util/newIteration.ts: 3 to 24 blocks, no
// thunder on 70% of days), so the tips name the chip and let it count.
const INTRO_BRICKS = 3;
const INTRO_POWER = 1;

type IntroBlock = Point & {
  local?: boolean;
  thunder?: boolean;
  active?: boolean;
};

// The build, one beat per entry, in the order of the real gestures: place, tap
// to upgrade, tap again to take back, drag to move, place what came back. The
// order is forced: useInputEnd upgrades a tapped block whenever `power > 0` and
// only removes it once no thunder is left, so a refund shown before the thunder
// would be a branch that can't execute.
//
// The drag is why this maze was chosen: (11,16) is placed and does nothing
// (+0.00s), and nudging it one cell to (10,16) is worth +3.66s and reroutes the
// run (6 nodes to 10). It reads as a placement not working, then working.
//
// The refund is followed by a RE-PLACE so the tour doesn't end holding an
// unspent piece, and so the last beat is a placement that releases the runner.
// (14,13) is the spot because the drag's reroute turns the corner there: the
// block lands on the runner's new turn and pushes it out to the right wall.
//
// The times below are what the maze does, not what the tour displays; the clock
// holds through the build (see Clock):
//
//   4.60 → 5.25 → 5.25 → 5.68 → 10.28 → 9.85 → 13.51 → 14.38  (3.1x bare)
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
  { kind: "place", at: { x: 14, y: 13 } },
];

// How far into BEATS each tip has played once you leave it. Steps 0 and 1 (the
// opening run and the goal) touch nothing; the last tip owns the refund, drag
// and re-place, and the built run starts under it.
const BEATS_DONE = [0, 0, 3, 4, 7];
const LAST_STEP = 4;
// The maze is locked once the last beat lands, the earliest the runner can be
// released, as a real build finishes before the runner goes.
const LAST_BEAT = BEATS.length;
// The one beat that ANIMATES rather than landing instantly (see the drag effect
// below). The scheduler uses it to hold the next beat until the block has
// finished sliding.
const MOVE_BEAT = BEATS.findIndex((b) => b.kind === "move");
const MOVE_MS = 900;
// Beat spacing: a short lead-in, just long enough for the new words to land,
// then wider gaps so consecutive placements read as separate events.
const LEAD_MS = 400;
const STEP_MS = 700;
// After the last beat lands, before the runner goes.
const RELEASE_MS = 1_500;

// The pause AFTER a beat, before the next. The drag has already spent MOVE_MS
// sliding. The refund and drag get more room than a placement: their tip plays
// three different gestures, each wanting reading before the next.
const gapAfter = (beat: Beat) =>
  beat.kind === "move" ? MOVE_MS + 350 : beat.kind === "refund" ? 900 : STEP_MS;

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
      // down otherwise.
      (top !== undefined ? " tooltip--up" : " tooltip--down") +
      (right !== undefined ? " tooltip--right" : "")}
    style={{ top, left, right, bottom }}
  >
    {children}
  </div>
);

const Tip = (
  { children, left, right, top, bottom, onSkip, onNext, onReplay, last }: {
    children?: ComponentChildren;
    left?: CSSProperties["left"];
    right?: CSSProperties["right"];
    top?: CSSProperties["top"];
    bottom?: CSSProperties["bottom"];
    onSkip: () => void;
    onNext: () => void;
    // Last tip only, in the slot Skip vacates.
    onReplay?: (() => void) | undefined;
    last?: boolean;
  },
) => (
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
        // The last tip's two labels can outrun the box's max-width. Wrap the
        // ROW, never a label.
        flexWrap: "wrap",
        gap: 16,
      }}
    >
      {
        /* Stop the click bubbling to the overlay's onClick={advance}; otherwise
           a tap on Skip/Next fires twice and skips the next tip. */
      }
      {!last
        ? (
          <a
            onClick={(e) => {
              e.stopPropagation();
              onSkip();
            }}
          >
            {t("intro.skip")}
          </a>
        )
        : onReplay && (
          <a
            onClick={(e) => {
              e.stopPropagation();
              onReplay();
            }}
          >
            {t("intro.replay")}
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

// The game's own run clock (`.hud__run`, styles.css), on the right of
// `.hud__controls` where the HUD's clock lives, so the tour teaches the real
// strip: budgets left, clock right.
//
// A STOPWATCH, not a readout of the maze: it counts while the runner moves,
// holds while paused or stopped, and derives nothing from the board. So it
// shows no time during the build, as in the real game. The "longer is better"
// argument rests on two runs, 4.60s and 13.51s.
//
// Holding while paused is free: Runner stops publishing, so the last value
// stands. A separate component because the signal changes every frame and
// reading it in IntroBoard would re-render Board at that rate.
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

export const IntroBoard = (
  // `onReplay` restarts the tour. It is the caller's job: App remounts this
  // component on a fresh key, so all state resets by construction.
  { onDone, onReplay }: { onDone: () => void; onReplay?: () => void },
) => {
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
  // The runner is HELD, not unmounted, for the spawn beat and the checkpoint
  // stop: unmounting reads as blinking out, not stopping.
  const [paused, setPaused] = useState(true);
  // The last completed run's time; the clock holds it through the build.
  const [settled, setSettled] = useState(0);
  // The runner outlives its run, standing in the exit, so "has a runner" isn't
  // "is running". The clock needs the difference: the live walk stops a frame
  // PAST the true finish, and the tour quotes exact numbers.
  const [finished, setFinished] = useState(false);
  const haltedRef = useRef(false);
  const builtRef = useRef(0);

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

  // Timed off the solver the game validates with, so the clock never quotes a
  // number the runner doesn't walk.
  const bare = useMemo(() => localRun(INTRO_FIXED, introCheckpoint)!, []);
  // The path node nearest the checkpoint, where the opening run stops
  // (measured, not hard-coded).
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

  // Play every beat up to `upTo` not yet run, so tapping Next early lands the
  // same board as watching it build.
  const settle = useCallback((upTo: number) => {
    setBeatsDone((done) => {
      if (done >= upTo) return done;
      setBlocks((bs) => BEATS.slice(done, upTo).reduce(apply, bs));
      return upTo;
    });
  }, []);

  const advance = useCallback(() => {
    // The opening click releases the runner AND moves the tip on in the same
    // frame; delaying either half reads as the click half working. The runner
    // finishes the route under the next tip, which is about the clock. (Build
    // beats do wait, so the new words land before the board moves; here the
    // runner is already mid-route, so waiting reads as lag.)
    if (step === 0) {
      haltedRef.current = true; // clicked past it; don't stop later
      setPaused(false);
      return setStep(1);
    }
    // The bare run is cleared on leaving the goal tip, so the runner stays in
    // the exit while the tip talks about its time. Clicking before it arrives
    // still settles on the route's true time.
    if (step === 1) {
      setRun(undefined);
      setSettled(bare.duration);
    }
    setStep((s) => {
      if (s >= LAST_STEP) return s;
      settle(BEATS_DONE[s]!);
      return s + 1;
    });
  }, [step, bare, settle]);

  // The elapsed time at which the runner reaches the checkpoint. By DISTANCE,
  // not node index: the legs are uneven (a 1.4-unit hop, then an 8-unit run).
  // The bare board has no thunders, so time is proportional to distance.
  const haltAt = useMemo(() => {
    const seg = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
    let upTo = 0, total = 0;
    for (let i = 1; i < bare.path.length; i++) {
      const d = seg(bare.path[i - 1]!, bare.path[i]!);
      total += d;
      if (i <= cut) upTo += d;
    }
    return total === 0 ? 0 : bare.duration * (upTo / total);
  }, [bare, cut]);

  // The opening. The runner mounts HELD so the spawn is seen before it moves.
  useEffect(() => {
    setRun(bare);
    const timer = setTimeout(() => setPaused(false), 700);
    return () => clearTimeout(timer);
  }, [bare]);

  // The stop on the checkpoint, off the runner's elapsed seconds so it lands
  // where the runner is. Subscribing, not reading `.value` in render, keeps a
  // per-frame signal from re-rendering the board.
  //
  // It then WAITS for the reader's click: the stop is the argument that the
  // checkpoint is compulsory, and a timed resume hurries past it.
  useEffect(() => {
    if (step !== 0) return;
    return runnerTime.subscribe((now) => {
      if (now === undefined || haltedRef.current || now < haltAt) return;
      haltedRef.current = true;
      setPaused(true);
    });
  }, [step, haltAt]);

  // Each build tip plays its beats after a short pause so the tip is read
  // first, one at a time (simultaneous blocks read as one event).
  useEffect(() => {
    if (step === 0 || step === 1) return;
    const from = BEATS_DONE[step - 1]!, to = BEATS_DONE[step]!;
    const timers: number[] = [];
    let delay = LEAD_MS;
    for (let i = from; i < to; i++) {
      timers.push(setTimeout(() => settle(i + 1), delay));
      delay += gapAfter(BEATS[i]!);
    }
    return () => timers.forEach(clearTimeout);
  }, [step, settle]);

  // The move beat uses the real drag machinery: the block lifts, the overlay
  // glides to the target, then lands. `settle` has already moved the block, so
  // `mover` sits at the DESTINATION and must be passed as itself: Board hides
  // the grabbed block by identity (`block === transitionBlock`), and a copy
  // would leave it drawn, reading as a second block.
  useEffect(() => {
    const beat = BEATS[MOVE_BEAT]!;
    if (beat.kind !== "move" || beatsDone !== MOVE_BEAT + 1) return;
    const mover = blocksRef.current.find((b) =>
      b.x === beat.to.x && b.y === beat.to.y && b.local
    );
    if (!mover) return;
    setTransition(mover);
    setDragMoved(true);
    setPlacing({ ...beat.from, placing: true });
    const timers = [
      setTimeout(() => setPlacing({ ...beat.to, placing: true }), 400),
      setTimeout(() => {
        setTransition(undefined);
        setDragMoved(false);
        setPlacing({ ...beat.to, placing: false });
      }, MOVE_MS),
    ];
    return () => timers.forEach(clearTimeout);
  }, [beatsDone]);

  // The built run, released once the last beat has landed. The last beat is the
  // re-place, which the scheduler holds until the drag has finished sliding, so
  // nothing is still animating. There is no finale step: the run starts under
  // the tip already up.
  useEffect(() => {
    if (beatsDone < LAST_BEAT) return;
    const timer = setTimeout(() => {
      const built = localRun(blocksRef.current, introCheckpoint);
      if (!built) return;
      haltedRef.current = true; // it stops for nothing; the checkpoint is explained
      builtRef.current = built.duration;
      setSettled(0);
      setFinished(false);
      setRun(built);
      setPaused(false);
    }, RELEASE_MS);
    return () => clearTimeout(timer);
  }, [beatsDone]);

  const onFinish = useCallback(() => {
    // Which run ended is decided by the BEATS, not the step: the opening click
    // advances the step, so the bare run routinely finishes with the step
    // already moved on. Either way the clock takes over from the live walk,
    // which stops a frame past the finish (4.61 for a 4.60 route).
    setFinished(true);
    if (beatsDone >= LAST_BEAT) {
      // The built run. The tour waits here instead of closing on a timer, so
      // the final frame stays readable; Play (or a tap) ends it.
      setSettled(builtRef.current);
      return;
    }
    // The bare run keeps its runner; `advance` clears it.
    setSettled(bare.duration);
    setStep((cur) => (cur === 0 ? 1 : cur));
  }, [beatsDone, bare]);

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

  // Anchors are the ARROW's target in board coordinates: `left`/`right` of L%
  // is x = L% of the 20-cell board (`right` mirrors it, swinging the box
  // leftward), `top`/`bottom` likewise vertically, `bottom` putting the box
  // ABOVE its target. A block at cell (x, y) spans x/20 … (x+1)/20.
  const tips: [ComponentChildren, Record<string, unknown>][] = [
    // The checkpoint, drawn 0.9 wide at cp+0.55 so its centre is cp+1:
    // (3.5,14.5) centres at 22.5% across, top edge at 75%.
    [t("intro.tipRoute"), { bottom: "25%", left: "22.5%" }],
    // The clock pill, in the right-hand group above the board.
    [t("intro.tipGoal"), { top: -12, right: 40 }],
    // (8,17), the FIRST placement to land (the last takes ~1.8s to appear).
    // Blocks draw 2x2: centre (8+1)/20 = 45% across, top edge at 85%.
    [t("intro.tipBlocks"), { bottom: "15%", left: "45%" }],
    // The same block, now the thunder; the anchor holds so the tip doesn't hop.
    [t("intro.tipThunder"), { bottom: "15%", left: "45%" }],
    // (7,15), the block the refund takes back: centre 40% across, top edge 75%.
    // The box opens LEFT (hence `right`) because opening rightward would cover
    // the re-placed block at (14,13) and the runner's turn there.
    [t("intro.tipFix"), { bottom: "25%", right: "60%" }],
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
          <Clock running={!!run && !finished} settled={settled} />
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
          /* The last tip stays up while the built run walks; there is no
            separate finale step. */
        }
        <Tip
          {...tips[step]![1]}
          onNext={step < LAST_STEP ? advance : onDone}
          onSkip={onDone}
          onReplay={onReplay}
          last={step === LAST_STEP}
        >
          {tips[step]![0]}
        </Tip>
      </div>
    </div>
  );
};
