import { h } from "preact";
import { Board } from "./Board.tsx";
import { useCallback, useEffect, useRef, useState } from "preact/compat";
import { Point } from "../../common/types.ts";

const initialBlocks = [
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

export const IntroBoard = () => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [blocks, setBlocks] = useState(initialBlocks);
  const [thunders, setThunders] = useState<typeof initialBlocks>([]);
  const [time, setTime] = useState(9);
  const [run, setRun] = useState<
    {
      path: Point[];
      duration: number;
      slows: { time: number; thunder: Point }[];
    }
  >();

  useEffect(() => {
    let step = 0;
    const interval = setInterval(() => {
      if (step === 0) setBlocks((b) => [...b, { x: 16, y: 14, local: true }]);
      if (step === 1) setBlocks((b) => b.filter((_, i) => i !== 32));
      if (step === 2) setBlocks((b) => [...b, { x: 12, y: 12, local: true }]);
      if (step === 3) setBlocks((b) => [...b, { x: 10, y: 12, local: true }]);
      if (step === 4) {
        setBlocks((b) => b.filter((_, i) => i !== 34));
        setThunders((t) => [...t, { x: 12, y: 12, local: true }]);
      }
      if (step === 5) setBlocks((b) => b.filter((_, i) => i !== 32));
      if (step === 6) setBlocks((b) => [...b, { x: 2, y: 2, local: true }]);
      if (step === 7) setBlocks((b) => [...b, { x: 2, y: 4, local: true }]);
      if (step === 8) setRun(storedRun);
      if (step === 40) {
        setBlocks(initialBlocks);
        setThunders([]);
        setRun(undefined);
        setTime(9);
        step = -1;
      }

      setTime((t) => t - 1);
      step++;
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const onSlow = useCallback((thunder: Point) => {
    // Animate thunder tower
    setThunders(
      (thunders) =>
        thunders.map((t) =>
          t.x === thunder.x && t.y === thunder.y
            ? { ...thunder, active: true }
            : t
        ),
    );

    // Remove thunder tower animation after 0.1s
    setTimeout(() => {
      setThunders(
        (thunders) =>
          thunders.map((t) =>
            t.x === thunder.x && t.y === thunder.y
              ? { ...thunder, active: false }
              : t
          ),
      );
    }, 100);
  }, []);

  return (
    <Board
      placingBlock={{ x: 0, y: 0, placing: false }}
      touching={false}
      time={time}
      svgRef={svgRef}
      transitionBlock={undefined}
      power={run ? -1 : 1 - thunders.length}
      thunders={thunders}
      thunderHover={undefined}
      bricks={run ? -1 : 37 - blocks.length - thunders.length}
      blocks={blocks}
      checkpoint={{ x: 10.5, y: 4.5 }}
      invalid={false}
      run={run}
      onFinish={() => {}}
      grid={[]}
      disconnected={false}
      onSlow={onSlow}
      rating={NaN}
      lastRating={NaN}
    />
  );
};
