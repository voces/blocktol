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
// So this one was searched for against the properties that make a route legible
// at a glance, and it holds all of them:
//
//   (9,19) → (10,18) → (18,18) → (18,12) → (12,2) → (10,1) → (10,0)
//
// seven nodes, no segment walked twice, and a 90° bend at the checkpoint — in
// along the bottom, out on one long diagonal. The corner checkpoint is doing
// deliberate work: the runner visibly leaves its way to touch it, which is what
// makes "it HAS to go there" something the board says rather than the copy.
const INTRO_FIXED: Point[] = [
  { x: 10, y: 3 },
  { x: 11, y: 6 },
  { x: 3, y: 16 },
  { x: 14, y: 12 },
  { x: 16, y: 13 },
  { x: 13, y: 8 },
];

export const introCheckpoint: Point = { x: 17.5, y: 17.5 };

// The budgets the walkthrough spends, and the numbers its copy quotes — passed
// to the tips as ICU args rather than written into the sentences, so the two
// can't drift apart.
const INTRO_BRICKS = 3;
const INTRO_POWER = 1;

type IntroBlock = Point & {
  local?: boolean;
  thunder?: boolean;
  active?: boolean;
};

// The build, one beat per entry. Each was picked by measuring the maze rather
// than by eye: the three placements are the greedy best-time sequence for the
// real 3-brick budget, and the refund/move act on the cheapest block so that
// taking one back reads as a small, honest cost rather than throwing the run
// away. The clock this produces climbs 6.06 → 6.64 → 7.82 → 8.92, dips to 7.69
// over the edit, then lands on 12.29 when the thunder goes in — so the tour
// ends on its largest gain, at double where it opened.
type Beat =
  | { kind: "place"; at: Point }
  | { kind: "refund"; at: Point }
  | { kind: "move"; from: Point; to: Point }
  | { kind: "thunder"; at: Point };

const BEATS: Beat[] = [
  { kind: "place", at: { x: 10, y: 17 } },
  { kind: "place", at: { x: 8, y: 15 } },
  { kind: "place", at: { x: 6, y: 13 } },
  { kind: "refund", at: { x: 6, y: 13 } },
  { kind: "move", from: { x: 8, y: 15 }, to: { x: 8, y: 16 } },
  { kind: "thunder", at: { x: 10, y: 17 } },
];

// How far into BEATS each tip has played by the time you leave it. Step 0 and 1
// are the opening run and the goal, so they touch nothing.
const BEATS_DONE = [0, 0, 3, 5, 6, 6];
const LAST_STEP = 5;

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

// The clock reads the runner's own elapsed-seconds signal, so it ticks while the
// runner walks and settles on the maze's time when it stops. Its own component
// on purpose: that signal is written every frame, and reading it up in IntroBoard
// would re-render Board — and the whole board — at that rate.
const Clock = (
  { settled, offset, holding }: {
    settled: number;
    offset: number;
    // True across the halt on the checkpoint, where no runner is mounted and so
    // no elapsed time is being published. Without it the clock falls back to the
    // settled time for those 800ms — flashing the route's FINAL number in the
    // middle of the walk, which reads as a glitch and gives the total away
    // before the runner has earned it. Hold at the handover instead.
    holding: boolean;
  },
) => {
  const live = runnerTime.value;
  const shown = live !== undefined ? offset + live : holding ? offset : settled;
  return <span class="mono">{shown.toFixed(2)}s</span>;
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
  // Which half of the opening route is walking: 1 to the checkpoint, 2 out the
  // top, 3 once the route has been shown. The finale run uses 4.
  const [leg, setLeg] = useState(0);
  const [clockOffset, setClockOffset] = useState(0);

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
    setStep((s) => {
      if (s >= LAST_STEP) return s;
      settle(BEATS_DONE[s]);
      return s + 1;
    });
  }, [settle]);

  // The opening: the runner walks to the checkpoint, STOPS on it, then leaves.
  // That halt is what the tour has instead of a sentence claiming the checkpoint
  // is compulsory — the board makes the case, and the copy keeps only what the
  // picture can't say.
  useEffect(() => {
    if (step !== 0 || leg !== 0) return;
    const timer = setTimeout(() => {
      setLeg(1);
      setRun({ ...bare, path: bare.path.slice(0, cut + 1) });
    }, 600);
    return () => clearTimeout(timer);
  }, [step, leg, bare, cut]);

  // Each build tip plays its beats after a beat's pause, so the tip is read
  // before the board moves under it.
  useEffect(() => {
    if (step === 0 || step === 1) return;
    const timer = setTimeout(() => settle(BEATS_DONE[step]), 900);
    return () => clearTimeout(timer);
  }, [step, settle]);

  // The move beat is the real drag machinery, not a jump: the block lifts (its
  // origin drawn hidden), the overlay glides to the target, then it lands.
  useEffect(() => {
    const beat = BEATS[4];
    if (beat.kind !== "move" || beatsDone !== 5) return;
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

  // The finale: release the runner over the maze the tour just built. Same
  // solver, so the clock's closing number is the one it walks.
  useEffect(() => {
    if (step !== LAST_STEP || !live) return;
    const timer = setTimeout(() => {
      setLeg(4);
      setClockOffset(0);
      setRun(live);
    }, 700);
    return () => clearTimeout(timer);
  }, [step, live]);

  const onFinish = useCallback(() => {
    setRun(undefined);
    setLeg((l) => {
      if (l === 1) {
        // Held on the checkpoint before the second half — the stop is the point.
        setClockOffset(bare.duration * cutFraction);
        setTimeout(() => {
          setLeg(2);
          setRun({ ...bare, path: bare.path.slice(cut) });
        }, 800);
        return 1;
      }
      if (l === 2) {
        setClockOffset(0);
        setStep((s) => (s === 0 ? 1 : s));
        return 3;
      }
      setTimeout(onDone, 1_000);
      return l;
    });
  }, [bare, cutFraction, onDone]);

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

  const tips: [ComponentChildren, Record<string, unknown>][] = [
    // Upper-left: the only quadrant the route leaves alone. It runs the bottom
    // edge, up the right, then diagonally across — so a tip anywhere else covers
    // the runner during the one demo the player is meant to be watching.
    [t("intro.tipRoute"), { top: "12%", left: "8%" }],
    [t("intro.tipGoal"), { top: -12, left: 41 }],
    [t("intro.tipBlocks", { count: INTRO_BRICKS }), {
      top: "22%",
      left: "12%",
    }],
    [t("intro.tipFix"), { top: "44%", left: "14%" }],
    [t("intro.tipThunder", { count: INTRO_POWER }), {
      top: "34%",
      left: "14%",
    }],
    [null, { top: "22%", left: "12%" }],
  ];

  return (
    <div class="onboarding">
      <div class="hud">
        <div class="hud__chips">
          {
            /* The clock leads: it is the score, and until now the tour never put
              a number on the thing it was asking the player to grow. */
          }
          <div class="hud__chip">
            <Clock
              settled={duration}
              offset={clockOffset}
              holding={leg === 1 || leg === 2}
            />
          </div>
          <div class="hud__chip">
            <BrickIcon />
            <span class="mono">{bricks}</span>
          </div>
          <div class="hud__chip">
            <PowerIcon />
            <span class="mono">{power}</span>
          </div>
        </div>
      </div>
      <Board
        placingBlock={placing}
        touching={false}
        time={run ? -1 : 9}
        svgRef={svgRef}
        transitionBlock={transition}
        power={run ? -1 : power}
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
          backgroundColor: run ? undefined : "#0001",
          borderRadius: "var(--radius)",
        }}
        onClick={step < LAST_STEP ? advance : onDone}
      >
        {
          /* The last tip carries only the button — the finale is the runner
            walking the maze the tour built, and narrating that is the habit
            this rewrite is getting rid of. */
        }
        {step < LAST_STEP && (
          <Tip
            {...tips[step][1]}
            onNext={advance}
            onSkip={onDone}
          >
            {tips[step][0]}
          </Tip>
        )}
        {step === LAST_STEP && (
          <Tip {...tips[LAST_STEP][1]} onNext={onDone} onSkip={onDone} last />
        )}
      </div>
    </div>
  );
};
