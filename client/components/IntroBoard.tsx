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
  { x: 3, y: 2, local: true },
];

// Local blocks pre-placed in the starting maze — the baseline the brick budget
// counts up from.
const INITIAL_LOCAL = initialBlocks.filter((b) => b.local).length;

// The tutorial maze's checkpoint, shared with the decorative Start-attempt
// backdrop (Prestart.tsx).
export const introCheckpoint: Point = { x: 10.5, y: 4.5 };

const storedRun = {
  path: [
    { x: 9, y: 19 },
    { x: 10, y: 18 },
    { x: 14, y: 18 },
    { x: 14, y: 16 },
    { x: 18, y: 16 },
    { x: 18, y: 13 },
    { x: 17, y: 11 },
    { x: 15, y: 11 },
    { x: 15, y: 8 },
    { x: 16, y: 7 },
    { x: 16, y: 1 },
    { x: 13, y: 1 },
    { x: 12, y: 3 },
    { x: 11, y: 3 },
    { x: 11, y: 5 },
    { x: 11, y: 3 },
    { x: 12, y: 3 },
    { x: 13, y: 1 },
    { x: 16, y: 1 },
    { x: 16, y: 7 },
    { x: 15, y: 8 },
    { x: 15, y: 11 },
    { x: 17, y: 11 },
    { x: 18, y: 13 },
    { x: 18, y: 16 },
    { x: 15, y: 16 },
    { x: 13, y: 14 },
    { x: 9, y: 14 },
    { x: 9, y: 11 },
    { x: 11, y: 11 },
    { x: 11, y: 8 },
    { x: 9, y: 8 },
    { x: 8, y: 6 },
    { x: 7, y: 4 },
    { x: 7, y: 1 },
    { x: 9, y: 1 },
    { x: 9, y: 0 },
    { x: 10, y: 0 },
  ],
  duration: 30.98,
  slows: [
    { time: 1.48, thunder: { x: 12, y: 12 } },
    { time: 5.54, thunder: { x: 12, y: 12 } },
    { time: 15.92, thunder: { x: 12, y: 12 } },
    { time: 20.78, thunder: { x: 12, y: 12 } },
    { time: 24, thunder: { x: 12, y: 12 } },
  ],
};

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
      {!last && <a onClick={onSkip}>{t("intro.skip")}</a>}
      <a onClick={onNext}>{last ? t("intro.play") : t("intro.next")}</a>
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

  // Drive the "drag to move" demo through the real drag machinery the game uses:
  // `transition` is the grabbed block (its origin is drawn hidden), and `placing`
  // is the overlay block that glides to the target (the overlay already animates
  // its x/y in Board). `dragMoved` suppresses the thunder-radius preview that a
  // real drag shows before it moves. Latest blocks via a ref so the choreography's
  // deferred steps read past the refund that ran just before it.
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
      // case the reader clicked Next before its interval finished), then the
      // interval for the new step plays that step's demo. The final tip's "Play"
      // (step 9) releases the runner; a stray click afterwards ends the tour.
      if (step === 6) setAttemptStep(7); // placements done → upgrade
      else if (step === 7) setAttemptStep(8); // upgrade done → refund
      else if (step === 8) setAttemptStep(9); // refund done → move
      else if (step === 9) setAttemptStep(10); // Play → release the runner
      else if (step === 10) onDone();

      return step;
    });
  }, []);

  useEffect(() => {
    let interval = -1;

    if (onboardingStep === 5) {
      interval = setInterval(() => {
        setAttemptStep((step) => {
          if (step > 6) {
            clearInterval(interval);
            return step;
          }
          return step + 1;
        });
      }, 750);
    } else if (onboardingStep === 6) {
      interval = setInterval(() => {
        setAttemptStep((step) => {
          if (step > 7) {
            clearInterval(interval);
            return step;
          }
          return step + 1;
        });
      }, 750);
    } else if (onboardingStep === 7) {
      // tipRefund: play the refund (board step 8) after a beat.
      interval = setInterval(() => {
        setAttemptStep((step) => {
          if (step > 8) {
            clearInterval(interval);
            return step;
          }
          return step + 1;
        });
      }, 750);
    }

    return () => clearInterval(interval);
  }, [onboardingStep]);

  useEffect(() => {
    for (
      let step = lastAttemptStepRef.current;
      step < attemptStep;
      step++
    ) {
      if (step === 0) setBlocks((b) => [...b, { x: 16, y: 14, local: true }]);
      if (step === 1) setBlocks((b) => b.filter((_, i) => i !== 32));
      if (step === 2) setBlocks((b) => [...b, { x: 12, y: 12, local: true }]);
      if (step === 3) setBlocks((b) => [...b, { x: 10, y: 12, local: true }]);
      if (step === 4) setBlocks((b) => b.filter((_, i) => i !== 32));
      if (step === 5) setBlocks((b) => [...b, { x: 2, y: 2, local: true }]);
      if (step === 6) setBlocks((b) => [...b, { x: 2, y: 4, local: true }]);
      if (step === 7) {
        setBlocks((
          b,
        ) => [...b.filter((_, i) => i !== 33), {
          x: 12,
          y: 12,
          local: true,
          thunder: true,
        }]);
      }
      // Refund demo: remove the lower-left block (added at step 6). Removed by
      // coordinate, not index, so it survives edits to the placement demo above;
      // the brick chip ticks back up, showing the budget being reclaimed. This
      // also clears (2,4) as the landing cell for the move demo that follows.
      if (step === 8) {
        setBlocks((b) => b.filter((x) => !(x.x === 2 && x.y === 4 && x.local)));
      }
      if (step === 9) {
        setTime(-1);
        setRun(storedRun);
      }

      setTime((t) => t - 0.75);
    }

    lastAttemptStepRef.current = attemptStep;
  }, [attemptStep]);

  // Keep the latest blocks reachable from the move choreography's deferred steps.
  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  // tipMove: animate the upper-left block (2,2) sliding into the gap the refund
  // just opened at (2,4), reusing the real drag path — lift (origin hidden,
  // overlay at origin), glide the overlay to the target, then commit the block
  // and drop the overlay. Reads the block by coordinate off the ref so it picks
  // up the post-refund board; if it isn't there the demo simply no-ops.
  useEffect(() => {
    if (onboardingStep !== 8) return;
    let lifted = false;
    // Land the block at the target and drop the drag overlay.
    const commit = () => {
      setBlocks((b) =>
        b.map((x) =>
          x.x === 2 && x.y === 2 && x.local ? { ...x, x: 2, y: 4 } : x
        )
      );
      setTransition(undefined);
      setDragMoved(false);
      setPlacing({ x: 2, y: 4, placing: false });
    };
    const timers = [
      setTimeout(() => {
        const mover = blocksRef.current.find(
          (b) => b.x === 2 && b.y === 2 && b.local,
        );
        if (!mover) return;
        lifted = true;
        setTransition(mover);
        setDragMoved(true);
        setPlacing({ x: 2, y: 2, placing: true });
      }, 300),
      setTimeout(() => setPlacing({ x: 2, y: 4, placing: true }), 700),
      setTimeout(commit, 1200),
    ];
    return () => {
      timers.forEach(clearTimeout);
      // If "Play" was hit mid-glide, finish the move so the runner never plays
      // over a lifted block. Only if the lift ran — a fast skip leaves the block
      // untouched rather than teleporting it with no animation.
      if (lifted) commit();
    };
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
        onFinish={() => setTimeout(onDone, 1_000)}
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
          backgroundColor: onboardingStep < 9 ? "#0001" : undefined,
          // Match the board's rounded corners so the mask doesn't square off
          // over them (--radius is a fixed length, so it tracks at any board
          // size the same way the SVG's own rounding does).
          borderRadius: "var(--radius)",
        }}
        onClick={advance}
      >
        {onboardingStep === 0 && (
          <Tip top={-12} left={41} onNext={advance} onSkip={onDone}>
            {t("intro.tipBlocks")}
          </Tip>
        )}
        {onboardingStep === 1 && (
          <Tip top={-12} left={107} onNext={advance} onSkip={onDone}>
            {t("intro.tipThunders")}
          </Tip>
        )}
        {onboardingStep === 2 && (
          <Tip bottom="4.5%" left="47.5%" onNext={advance} onSkip={onDone}>
            {t("intro.tipRunnerBottom")}
          </Tip>
        )}
        {onboardingStep === 3 && (
          <Tip top="29.5%" left="57.5%" onNext={advance} onSkip={onDone}>
            {t("intro.tipCheckpoint")}
          </Tip>
        )}
        {onboardingStep === 4 && (
          <Tip top="4.5%" left="52.5%" onNext={advance} onSkip={onDone}>
            {t("intro.tipTop")}
          </Tip>
        )}
        {onboardingStep === 5 && (
          <Tip bottom="29%" right="15%" onNext={advance} onSkip={onDone}>
            {t("intro.tipPlace")}
          </Tip>
        )}
        {onboardingStep === 6 && (
          <Tip bottom="39%" right="35%" onNext={advance} onSkip={onDone}>
            {t("intro.tipUpgrade")}
          </Tip>
        )}
        {onboardingStep === 7 && (
          <Tip top="32%" left="9%" onNext={advance} onSkip={onDone}>
            {t("intro.tipRefund")}
          </Tip>
        )}
        {onboardingStep === 8 && (
          <Tip top="32%" left="9%" onNext={advance} onSkip={onDone} last>
            {t("intro.tipMove")}
          </Tip>
        )}
      </div>
    </div>
  );
};
