import { h } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/compat";
import { Point } from "../../../common/types.ts";
import { GameStateContext } from "./useGameState.ts";
import { timerPulse } from "./timerPulse.ts";

/**
 * Water-ripple time cue for the build window. Players heads-down on the board
 * lose track of the 60s clock, so at set marks a wave floods out across the
 * board's blue surface from the timer button — the button dips (see Hud) and a
 * crest races out, flowing *around* the pieces like water finding its level. A
 * felt nudge, not an alarm.
 *
 * The wave is a flood fill, not a circle: a Dijkstra distance field from the
 * source cell over the free cells (pieces are obstacles), rendered as one 1×1
 * cell per free square that lights and fades on a delay proportional to its
 * distance *through the maze*. So the front bends around blocks, leaves them
 * dark (never drawn over a piece), and dissipates as it travels — its crest
 * dimming with distance until it dies before the far wall.
 *
 * Marks descend so a single pass down the clock fires each once; the closing
 * seconds cluster (3/2/1) so the surface stirs more as the window runs out.
 * Only during a live `building` countdown — staged/viewing/running are inert.
 */
const RIPPLE_MARKS = [10, 3, 2, 1];

const N = 20; // board is 20×20; interior play area is cells 1..18.
const LO = 1;
const HI = 18;

// Wave tuning (see the flood fill below). DELAY_PER_UNIT sets travel speed (s of
// delay per unit of maze distance — small = fast); each cell's pulse length is
// the CSS `floodCell` duration. BASE_DELAY lets the crest launch as the button
// lands (its drop peaks ~0.14s in, see buildDrop). The crest dims gently with
// distance — DIM is how much brightness it sheds by the FARTHEST reachable cell
// (0.4 → the far wall still gets 60%), so it visibly reaches the whole board
// instead of dying mid-way. Every reachable cell is drawn; a longer maze just
// takes proportionally longer to fill, which is intended.
const DELAY_PER_UNIT = 0.02;
const BASE_DELAY = 0.14;
const DIM = 0.4;
const PEAK = 0.5;

// Fire each mark this many seconds EARLY — the cue leads the clock so the "1s"
// ripple kicks off at 1.25s left, giving the wave room to sweep out before the
// window closes. The whole-second `time` can't express a fractional lead, so the
// marks are read off the fractional deadline instead.
const LEAD = 0.25;

// 8-connected, and — unlike the runner — it DELIBERATELY jumps corners: a
// diagonal step is allowed even between two corner-touching pieces. Obeying the
// runner's no-squeeze rule would strand the pinched cells dark, and those holes
// would leak which gaps the runner can't pass — a hint. Water fills them, so the
// crest closes over every diagonal gap and reveals nothing.
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

// The free interior cell nearest an anchor point — the flood's source. The
// button sits above the top-right of the board, so the anchor is the top-right
// interior; if a piece sits exactly there the flood simply starts from the
// closest open cell.
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
// square. The farthest-launching cell is flagged `last` so its animation end
// can retire the whole wave without a timer.
const floodCells = (blocks: ReadonlyArray<Point>): Cell[] => {
  // Every piece is a 2×2 (see Block's `size`): a block at (x,y) fills the four
  // cells (x,y),(x+1,y),(x,y+1),(x+1,y+1). Mark all four so the crest leaves the
  // whole piece dark, not just its top-left corner.
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

  // Farthest reachable cell — normalizes the distance-dimming so the fade is
  // relative to THIS maze's span (the crest reaches the far wall whether the
  // board is open or a long winding maze).
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
      peak: PEAK * (1 - DIM * (d / norm)),
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
  // `blocks` changes at pointer speed while building; read it off a ref so it
  // isn't a dependency of the poll effect.
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  // Marks already fired this window, and the deadline they belong to — a fresh
  // attempt re-arms the clock to a new deadline, which clears and re-arms them.
  const firedRef = useRef<Set<number>>(new Set());
  const windowRef = useRef<number | null>(null);

  useEffect(() => {
    if (phase !== "building") return;
    // Poll the fractional time left (not the whole-second `time`) so each mark
    // can lead by LEAD; a 100ms tick catches every mark within ~0.1s of its
    // lead point. The interval is torn down the moment the build window ends.
    const tick = () => {
      const deadline = deadlineRef.current;
      if (deadline === null) return;
      if (deadline !== windowRef.current) {
        windowRef.current = deadline;
        firedRef.current.clear();
      }
      const remaining = (deadline - Date.now()) / 1000;
      // Never launch once the window is up — the runner is releasing; a wave
      // fired now would surface after it.
      if (remaining <= 0) return;
      const passed = RIPPLE_MARKS.filter((m) => remaining <= m + LEAD);
      if (!passed.some((m) => !firedRef.current.has(m))) return;
      // Mark every passed mark fired (a throttled tab that jumped several at
      // once must not later replay the ones it skipped), but launch just one
      // wave — the surface stirs once per crossing, never a burst.
      for (const m of passed) firedRef.current.add(m);
      const cells = floodCells(blocksRef.current);
      if (!cells.length) return;
      setWaves((w) => [...w, { id: nextId.current++, cells }]);
      // Cue the button's drop, in sync (it is the source).
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
        // Each wave is its own keyed subtree, so adding or retiring one never
        // makes Preact recycle a sibling wave's animating cells — that recycling
        // was cutting an in-flight wave short and re-animating stray cells.
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
              // The last-launching cell retires the whole wave when it finishes,
              // so no cell is cut short and no timer is needed.
              onAnimationEnd={c.last ? () => remove(wave.id) : undefined}
            />
          ))}
        </g>
      ))}
    </svg>
  );
};
