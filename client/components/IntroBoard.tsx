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
      {!last && <a onClick={onSkip}>Skip</a>}
      <a onClick={onNext}>{last ? "Play" : "Next"}</a>
    </div>
  </Tooltip>
);

export const IntroBoard = ({ onDone }: { onDone: () => void }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [blocks, setBlocks] = useState(initialBlocks);
  const [time, setTime] = useState(7);
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

  const advance = useCallback(() => {
    setOnboardingStep((step) => {
      step++;

      if (step === 6) setAttemptStep(7);
      else if (step === 7) setAttemptStep(9);
      else if (step === 8) onDone();

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
      if (step === 8) {
        setTime(-1);
        setRun(storedRun);
      }

      setTime((t) => t - 0.75);
    }

    lastAttemptStepRef.current = attemptStep;
  }, [attemptStep]);

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

  // The HUD chips mirror the game's strip so the "Bricks"/"Snowflakes" tips have
  // real chips to point at; both counts are derived from the blocks so they move
  // with the walkthrough. Bricks is the budget minus the blocks placed on top of
  // the pre-built maze (upgrading swaps a local block for a local thunder one, so
  // the local count — and thus bricks — is unchanged; only snowflakes drop).
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
        placingBlock={{ x: 0, y: 0, placing: false }}
        touching={false}
        time={Math.round(time)}
        svgRef={svgRef}
        transitionBlock={undefined}
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
        dragMoved={false}
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
          backgroundColor: onboardingStep < 7 ? "#0001" : undefined,
        }}
        onClick={advance}
      >
        {onboardingStep === 0 && (
          <Tip top={-12} left={41} onNext={advance} onSkip={onDone}>
            Bricks indicate how many blocks you can place.
          </Tip>
        )}
        {onboardingStep === 1 && (
          <Tip top={-12} left={107} onNext={advance} onSkip={onDone}>
            Snowflakes indicate how many blocks you can upgrade.
          </Tip>
        )}
        {onboardingStep === 2 && (
          <Tip bottom="4.5%" left="47.5%" onNext={advance} onSkip={onDone}>
            The runner is released from the bottom…
          </Tip>
        )}
        {onboardingStep === 3 && (
          <Tip top="29.5%" left="57.5%" onNext={advance} onSkip={onDone}>
            …heads towards the checkpoint…
          </Tip>
        )}
        {onboardingStep === 4 && (
          <Tip top="4.5%" left="52.5%" onNext={advance} onSkip={onDone}>
            …and then out the top.
          </Tip>
        )}
        {onboardingStep === 5 && (
          <Tip bottom="29%" right="15%" onNext={advance} onSkip={onDone}>
            Place blocks to elongate the runner's path.
          </Tip>
        )}
        {onboardingStep === 6 && (
          <Tip bottom="39%" right="35%" onNext={advance} onSkip={onDone} last>
            Upgrade blocks to slow the runner as they pass.
          </Tip>
        )}
      </div>
    </div>
  );
};
