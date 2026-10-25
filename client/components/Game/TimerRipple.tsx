import { h } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/compat";
import { type Point } from "../../../common/types.ts";
import { GameStateContext } from "./useGameState.ts";
import { timerPulse } from "./timerPulse.ts";

/**
 * Water-ripple time cue for the build window. At set marks a wave floods out
 * across the board from the timer button (which dips, see Hud), flowing around
 * the pieces. A nudge, not an alarm.
 *
 * The wave is a flood fill, not a circle: a Dijkstra distance field from the
 * source cell over the free cells (pieces are obstacles), drawn as one 1×1
 * cell per free square that lights and fades after a delay proportional to its
 * distance through the maze. The front bends around blocks and never draws
 * over a piece.
 *
 * Only during a live `building` countdown; staged/viewing/running are inert.
 */
// Remaining-seconds marks that fire a wave → the crest's peak brightness. It
// dims as the window closes, so the cue softens toward the end.
const MARK_PEAK: Record<number, number> = { 10: 0.4, 3: 0.3, 2: 0.3, 1: 0.3 };
const RIPPLE_MARKS = Object.keys(MARK_PEAK).map(Number).sort((a, b) => b - a);

const N = 20; // The board is 20×20; the play area is cells 1..18.
const LO = 1;
const HI = 18;

// Wave tuning. DELAY_PER_UNIT is seconds of delay per unit of maze distance
// (small = fast); each cell's pulse length is the CSS `floodCell` duration.
// BASE_DELAY launches the crest as the button lands (its drop peaks ~0.14s in,
// see buildDrop). DIM is the brightness shed by the farthest reachable cell
// (0.4: the far wall keeps 60%), so the crest reaches the whole board.
const DELAY_PER_UNIT = 0.02;
const BASE_DELAY = 0.14;
const DIM = 0.4;

// Marks fire this many seconds early (the "1s" ripple starts at 1.25s left) so
// the wave can sweep out before the window closes. The whole-second `time`
// can't express a fractional lead, so marks read the fractional deadline.
const LEAD = 0.25;

// 8-connected, and unlike the runner it jumps corners: a diagonal step is
// allowed between two corner-touching pieces. The runner's no-squeeze rule
// would leave pinched cells dark, hinting which gaps the runner can't pass.
const STEPS: Array<[number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

type Cell = {
  x: number;
  y: number;
  peak: number;
  delay: number;
  last: boolean;
};

const key = (x: number, y: number) => y * N + x;
const free = (x: number, y: number, blocked: Set<number>) =>
  x >= LO && x <= HI && y >= LO && y <= HI && !blocked.has(key(x, y));

// The free interior cell nearest an anchor point: the flood's source. The
// button sits above the board's top-right.
const nearestFree = (ax: number, ay: number, blocked: Set<number>): Point => {
  let best: Point = { x: HI, y: LO };
  let bestD = Infinity;
  for (let y = LO; y <= HI; y++) {
    for (let x = LO; x <= HI; x++) {
      if (!free(x, y, blocked)) continue;
      const d = (x - ax) ** 2 + (y - ay) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  return best;
};

// Dijkstra from the source over free cells, then a render cell per reachable
// square. `peak` is the crest brightness (see MARK_PEAK); the last-launching
// cell is flagged `last` so its animation end retires the wave without a timer.
const floodCells = (blocks: ReadonlyArray<Point>, peak: number): Cell[] => {
  // Every piece is 2×2 (see Block's `size`): block (x,y) fills four cells.
  const blocked = new Set<number>();
  for (const b of blocks) {
    blocked.add(key(b.x, b.y));
    blocked.add(key(b.x + 1, b.y));
    blocked.add(key(b.x, b.y + 1));
    blocked.add(key(b.x + 1, b.y + 1));
  }
  const src = nearestFree(17, 1, blocked);
  const dist = new Map<number, number>([[key(src.x, src.y), 0]]);
  // Small grid (≤324 cells): a linear extract-min is plenty.
  const pq: Array<[number, number, number]> = [[0, src.x, src.y]];
  while (pq.length) {
    let mi = 0;
    for (let i = 1; i < pq.length; i++) if (pq[i][0] < pq[mi][0]) mi = i;
    const [d, x, y] = pq.splice(mi, 1)[0];
    if (d > (dist.get(key(x, y)) ?? Infinity)) continue;
    for (const [dx, dy, w] of STEPS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!free(nx, ny, blocked)) continue;
      const nd = d + w;
      if (nd < (dist.get(key(nx, ny)) ?? Infinity)) {
        dist.set(key(nx, ny), nd);
        pq.push([nd, nx, ny]);
      }
    }
  }

  // The dimming is relative to this maze's span, so the crest reaches the far
  // wall on an open board or a winding maze alike.
  let maxDist = 0;
  for (const d of dist.values()) if (d > maxDist) maxDist = d;
  const norm = maxDist || 1;

  const cells: Cell[] = [];
  let maxDelay = -1;
  let lastIdx = 0;
  for (const [k, d] of dist) {
    const delay = BASE_DELAY + d * DELAY_PER_UNIT;
    cells.push({
      x: k % N,
      y: Math.floor(k / N),
      peak: peak * (1 - DIM * (d / norm)),
      delay,
      last: false,
    });
    if (delay > maxDelay) {
      maxDelay = delay;
      lastIdx = cells.length - 1;
    }
  }
  if (cells.length) cells[lastIdx].last = true;
  return cells;
};

type Wave = { id: number; cells: Cell[] };

export const TimerRipple = () => {
  const { phase, blocks, deadlineRef } = useContext(GameStateContext);
  const [waves, setWaves] = useState<Wave[]>([]);
  const nextId = useRef(0);
  // `blocks` changes at pointer speed; a ref keeps it out of the effect deps.
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  // Marks fired this window, and the deadline they belong to; a new deadline
  // clears them.
  const firedRef = useRef<Set<number>>(new Set());
  const windowRef = useRef<number | null>(null);

  useEffect(() => {
    if (phase !== "building") return;
    // Polls the fractional time left so each mark can lead by LEAD; a 100ms
    // tick catches a mark within ~0.1s.
    const tick = () => {
      const deadline = deadlineRef.current;
      if (deadline === null) return;
      if (deadline !== windowRef.current) {
        windowRef.current = deadline;
        firedRef.current.clear();
      }
      const remaining = (deadline - Date.now()) / 1000;
      // Never launch once the window is up: the runner is releasing.
      if (remaining <= 0) return;
      const passed = RIPPLE_MARKS.filter((m) => remaining <= m + LEAD);
      if (!passed.some((m) => !firedRef.current.has(m))) return;
      // Mark every passed mark fired (a throttled tab that skipped several
      // must not replay them) but launch one wave.
      for (const m of passed) firedRef.current.add(m);
      // The most urgent mark reached sets the intensity.
      const mark = Math.min(...passed);
      const cells = floodCells(blocksRef.current, MARK_PEAK[mark]);
      if (!cells.length) return;
      setWaves((w) => [...w, { id: nextId.current++, cells }]);
      // Cue the button's drop (see Hud).
      timerPulse.value++;
    };
    const iv = setInterval(tick, 100);
    return () => clearInterval(iv);
  }, [phase]);

  const remove = (id: number) => setWaves((w) => w.filter((x) => x.id !== id));

  if (waves.length === 0) return null;
  return (
    <svg class="board-ripple" viewBox="0 0 20 20" aria-hidden="true">
      {waves.map((wave) => (
        // Keyed per wave so adding or retiring one can't make Preact recycle
        // a sibling's animating cells, which cuts it short.
        <g key={wave.id}>
          {wave.cells.map((c) => (
            <rect
              key={`${c.x}-${c.y}`}
              class="board-ripple__cell"
              x={c.x}
              y={c.y}
              width={1}
              height={1}
              style={{ "--peak": c.peak, animationDelay: `${c.delay}s` }}
              // The last cell to finish retires the wave.
              onAnimationEnd={c.last ? () => remove(wave.id) : undefined}
            />
          ))}
        </g>
      ))}
    </svg>
  );
};
