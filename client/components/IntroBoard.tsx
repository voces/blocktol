import { ComponentChildren, h } from "preact";
import { Board } from "./Board.tsx";
import { BrickIcon, PowerIcon } from "./Game/Hud.tsx";
import {
  CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "preact/compat";
import { Point } from "../../common/types.ts";
import { localRun } from "./Game/helpers.ts";
import { t } from "../util/t.ts";

// Exported so the daily "Start attempt" overlay (Prestart.tsx) can render this
// same maze as a purely decorative, blurred backdrop — a real-looking board
// that is deliberately NOT today's puzzle, so the mask can't leak the layout the
// player is about to build.
export const initialBlocks: (Point & {
  local?: boolean;
  thunder?: boolean;
  active?: boolean;
})[] = [
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

// Local blocks pre-placed in the starting maze — the baseline the brick budget
// counts up from.
const INITIAL_LOCAL = initialBlocks.filter((b) => b.local).length;

// The tutorial maze's checkpoint, shared with the decorative Start-attempt
// backdrop (Prestart.tsx).
export const introCheckpoint: Point = { x: 10.5, y: 4.5 };

const Tooltip = (
  { children, left, right, top, bottom }: {
    children: ComponentChildren;
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
  children: ComponentChildren;
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

export const IntroBoard = ({ onDone }: { onDone: () => void }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [blocks, setBlocks] = useState(initialBlocks);
  const [time, setTime] = useState(9);
  const [run, setRun] = useState<
    {
      path: Point[];
      duration: number;
      slows: { time: number; thunder: Point }[];
    }
  >();
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [attemptStep, setAttemptStep] = useState(0);
  const lastAttemptStepRef = useRef(0);
  // Steps 0–2 narrate the route while the runner actually walks it (see the
  // opening-lap effect); step 3 onward is the static build walkthrough.
  const [openingLap, setOpeningLap] = useState(0);
  const opening = onboardingStep <= 2;

  // Drive the "drag to move" demo through the real drag machinery the game uses:
  // `transition` is the grabbed block (its origin is drawn hidden), and `placing`
  // is the overlay block that glides to the target (the overlay already animates
  // its x/y in Board). `dragMoved` suppresses the thunder-radius preview that a
  // real drag shows before it moves. Latest blocks via a ref so the choreography
  // and the live path computation read the board as it stands at that moment.
  const [placing, setPlacing] = useState<Point & { placing: boolean }>({
    x: 0,
    y: 0,
    placing: false,
  });
  const [transition, setTransition] = useState<
    | (Point & { local?: boolean; thunder?: boolean; active?: boolean })
    | undefined
  >();
  const [dragMoved, setDragMoved] = useState(false);
  const blocksRef = useRef(blocks);

  const advance = useCallback(() => {
    setOnboardingStep((step) => {
      step++;

      // Each hop force-completes the demo the previous tip was auto-playing (in
      // case the reader clicked Next before its interval finished). tipMove
      // (step 9) is the last tip: its move is choreographed below and it then
      // auto-releases the runner — no further step. "Play" finishes onboarding.
      // Each currency chip is now explained one step AFTER the verb that spends
      // it, so the force-complete is what guarantees the chip has already ticked
      // when its tip points at it.
      if (step === 5) setAttemptStep(1); // place done → blocks chip
      else if (step === 7) setAttemptStep(2); // upgrade done → thunders chip
      else if (step === 9) setAttemptStep(3); // refund done → move

      return step;
    });
  }, []);

  // The opening demo, and the reason the walkthrough starts with it: the most
  // common first-run misreading is that the checkpoint is a target the PLAYER
  // builds toward — that placing blocks is how you ROUTE the runner to it. The
  // runner is autonomous and optimal (it always takes the shortest way it can
  // find), so the player's job is the opposite: obstruct. Copy alone loses that
  // argument to the board, which shows a distinctly-coloured square and, until
  // now, nothing moving — so before any tip about building, the runner threads
  // the pre-built maze on its own and the question "who moves this thing?" is
  // answered by the board.
  //
  // It LOOPS while the three route tips are read: one lap ends well inside tip
  // 0 for an unhurried reader, and tips 1–2 narrating a static board again is
  // the very thing this replaces. Leaving the opening clears the runner and
  // restores a positive `time` — the gate Board draws the walker behind.
  useEffect(() => {
    if (!opening) {
      setRun(undefined);
      setTime(9);
      return;
    }
    setTime(-1);
    // A fresh solve each lap: Runner keys its walk on the path's identity, so a
    // new array is what restarts it. A beat between laps so the restart reads as
    // another lap rather than a teleport back to the start.
    const timer = setTimeout(
      () => setRun(localRun(initialBlocks, introCheckpoint)),
      openingLap === 0 ? 0 : 500,
    );
    return () => clearTimeout(timer);
  }, [opening, openingLap]);

  // Auto-play each build tip's single board change after a short beat. tipMove
  // (step 9) is handled by the move choreography instead.
  useEffect(() => {
    const board = onboardingStep === 4
      ? 1
      : onboardingStep === 6
      ? 2
      : onboardingStep === 8
      ? 3
      : undefined;
    if (board === undefined) return;
    // A beat so the tip is read before its demo plays — and, for the refund,
    // long enough that the block being reclaimed is on screen when the tip
    // appears, then visibly disappears.
    const timer = setTimeout(() => setAttemptStep(board), 1100);
    return () => clearTimeout(timer);
  }, [onboardingStep]);

  useEffect(() => {
    for (let step = lastAttemptStepRef.current; step < attemptStep; step++) {
      // 0: place the one missing block (path lengthens); 1: upgrade a block to a
      // thunder in place (path slows); 2: refund a top-left block (brick chip
      // ticks back up). The runner is released later, by the move choreography.
      if (step === 0) setBlocks((b) => [...b, { x: 16, y: 14, local: true }]);
      if (step === 1) {
        setBlocks((b) =>
          b.map((x) =>
            x.x === 11 && x.y === 12 && x.local ? { ...x, thunder: true } : x
          )
        );
      }
      if (step === 2) {
        setBlocks((b) => b.filter((x) => !(x.x === 2 && x.y === 6 && x.local)));
      }
      // Cosmetic countdown, ticking while the maze is being built.
      setTime((t) => t - 0.75);
    }

    lastAttemptStepRef.current = attemptStep;
  }, [attemptStep]);

  // Keep the latest blocks reachable from the move choreography's deferred steps.
  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  // tipMove (the last tip): animate the top-left block (2,4) down a single tile to
  // (2,5), reusing the real drag path — lift (origin hidden, overlay at origin),
  // glide the overlay to the target, then commit the block and drop the overlay.
  // Reads the block by coordinate off the ref; if it isn't there the demo no-ops.
  useEffect(() => {
    if (onboardingStep !== 9) return;
    // Land the block at the target and drop the drag overlay.
    const commit = () => {
      setBlocks((b) =>
        b.map((x) => x.x === 2 && x.y === 4 && x.local ? { ...x, y: 5 } : x)
      );
      setTransition(undefined);
      setDragMoved(false);
      setPlacing({ x: 2, y: 5, placing: false });
    };
    // Once the move has landed, release the runner automatically along the live
    // path for the maze as it now stands (same solver the game uses, so it can
    // never drift from what the walkthrough built). This is the finale — the
    // player watches, or taps "Play" to drop straight into the game.
    const release = () => {
      setTime(-1);
      const r = localRun(blocksRef.current, introCheckpoint);
      if (r) setRun(r);
    };
    const timers = [
      setTimeout(() => {
        const mover = blocksRef.current.find(
          (b) => b.x === 2 && b.y === 4 && b.local,
        );
        if (!mover) return;
        setTransition(mover);
        setDragMoved(true);
        setPlacing({ x: 2, y: 4, placing: true });
      }, 300),
      setTimeout(() => setPlacing({ x: 2, y: 5, placing: true }), 700),
      setTimeout(commit, 1200),
      setTimeout(release, 1700),
    ];
    return () => timers.forEach(clearTimeout);
  }, [onboardingStep]);

  const onSlow = useCallback((thunder: Point) => {
    // Animate thunder tower
    setBlocks(
      (thunders) =>
        thunders.map((t) =>
          t.x === thunder.x && t.y === thunder.y
            ? { ...thunder, active: true }
            : t
        ),
    );

    // Remove thunder tower animation after 0.1s
    setTimeout(() => {
      setBlocks(
        (thunders) =>
          thunders.map((t) =>
            t.x === thunder.x && t.y === thunder.y
              ? { ...thunder, active: false }
              : t
          ),
      );
    }, 100);
  }, []);

  // The HUD chips mirror the game's strip so the block/thunder tips have real
  // chips to point at; both counts are derived from the blocks so they move with
  // the walkthrough. The block budget is the total minus the blocks placed on top
  // of the pre-built maze (upgrading swaps a local block for a local thunder one,
  // so the local count — and thus the block budget — is unchanged; only the
  // thunder count drops).
  const snowflakes = Math.max(0, 1 - blocks.filter((b) => b.thunder).length);
  const bricks = Math.max(
    0,
    3 - (blocks.filter((b) => b.local).length - INITIAL_LOCAL),
  );

  return (
    <div class="onboarding">
      <div class="hud">
        <div class="hud__chips">
          <div class="hud__chip">
            <BrickIcon />
            <span class="mono">{bricks}</span>
          </div>
          <div class="hud__chip">
            <PowerIcon />
            <span class="mono">{snowflakes}</span>
          </div>
        </div>
      </div>
      <Board
        placingBlock={placing}
        touching={false}
        time={Math.round(time)}
        svgRef={svgRef}
        transitionBlock={transition}
        power={run ? -1 : 1 - blocks.filter((b) => b.thunder).length}
        thunderHover={undefined}
        blocks={blocks}
        checkpoint={introCheckpoint}
        invalid={false}
        run={run}
        onFinish={() => {
          // Opening: drop the walker and queue another lap. Finale: the
          // walkthrough is over, so fall into the game a beat later.
          if (opening) {
            setRun(undefined);
            setOpeningLap((n) => n + 1);
            return;
          }
          setTimeout(onDone, 1_000);
        }}
        grid={[]}
        onSlow={onSlow}
        date={NaN}
        dragMoved={dragMoved}
      />
      <div
        style={{
          // Track the board's actual width (it shrinks to fit the padded
          // container on mobile) so the tips stay aligned to the board.
          width: "min(var(--maze-size), 100%)",
          height: 0,
          paddingBottom: "min(var(--maze-size), 100%)",
          margin: "calc(-1 * min(var(--maze-size), 100%)) auto 0",
          position: "relative",
          fontSize: "calc(min(400px, var(--maze-size)) / 20)",
          filter: "drop-shadow(1px 1px 4px rgba(0, 0, 0, 0.5))",
          // Dim the board so the tips pop; undim once the runner is released so
          // the finale plays clear.
          backgroundColor: run ? undefined : "#0001",
          // Match the board's rounded corners so the mask doesn't square off
          // over them (--radius is a fixed length, so it tracks at any board
          // size the same way the SVG's own rounding does).
          borderRadius: "var(--radius)",
        }}
        // Tap anywhere to proceed through the tips; on the last tip, tapping
        // (like "Play") drops straight into the game.
        onClick={onboardingStep < 9 ? advance : onDone}
      >
        {
          /* Steps 0–2: the route, narrated over the looping opening run — the
             runner is walking it as these are read. Anchors sweep the board once,
             bottom → checkpoint → top, matching the walk. */
        }
        {onboardingStep === 0 && (
          <Tip bottom="4.5%" left="47.5%" onNext={advance} onSkip={onDone}>
            {t("intro.tipRunnerBottom")}
          </Tip>
        )}
        {onboardingStep === 1 && (
          <Tip top="29.5%" left="57.5%" onNext={advance} onSkip={onDone}>
            {t("intro.tipCheckpoint")}
          </Tip>
        )}
        {onboardingStep === 2 && (
          <Tip top="4.5%" left="52.5%" onNext={advance} onSkip={onDone}>
            {t("intro.tipTop")}
          </Tip>
        )}
        {
          /* Names what the three above have just SHOWN: the runner chose that
             route, and the player can only obstruct it. Static board — the lap
             has stopped, so the sentence lands on a still frame. */
        }
        {onboardingStep === 3 && (
          <Tip top="40%" left="15%" onNext={advance} onSkip={onDone}>
            {t("intro.tipAuto")}
          </Tip>
        )}
        {
          /* Steps 4–9: the build verbs, each followed by the chip it spends, so
             a currency is explained on the beat its counter ticks. */
        }
        {onboardingStep === 4 && (
          <Tip bottom="29.5%" right="15%" onNext={advance} onSkip={onDone}>
            {t("intro.tipPlace")}
          </Tip>
        )}
        {onboardingStep === 5 && (
          <Tip top={-12} left={41} onNext={advance} onSkip={onDone}>
            {t("intro.tipBlocks")}
          </Tip>
        )}
        {onboardingStep === 6 && (
          <Tip bottom="39.5%" right="40%" onNext={advance} onSkip={onDone}>
            {t("intro.tipUpgrade")}
          </Tip>
        )}
        {onboardingStep === 7 && (
          <Tip top={-12} left={107} onNext={advance} onSkip={onDone}>
            {t("intro.tipThunders")}
          </Tip>
        )}
        {onboardingStep === 8 && (
          <Tip top="39.5%" left="15%" onNext={advance} onSkip={onDone}>
            {t("intro.tipRefund")}
          </Tip>
        )}
        {onboardingStep === 9 && (
          <Tip top="34.5%" left="15%" onNext={onDone} onSkip={onDone} last>
            {t("intro.tipMove")}
          </Tip>
        )}
      </div>
    </div>
  );
};
