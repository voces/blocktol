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
 * seconds cluster (5/3/2/1) so the surface stirs more as the window runs out.
 * Only during a live `building` countdown — staged/viewing/running are inert.
 */
const RIPPLE_MARKS = [30, 15, 10, 5, 3, 2, 1];

const N = 20; // board is 20×20; interior play area is cells 1..18.
const LO = 1;
const HI = 18;

// Wave tuning (see the flood fill below). DELAY_PER_UNIT sets travel speed (s of
// delay per unit of maze distance — small = fast); each cell's pulse length is
// the CSS `floodCell` duration. BASE_DELAY lets the crest launch as the button
// lands (its drop peaks ~0.24s in, see buildDrop). REACH is the distance the
// crest survives to — peak brightness ramps to zero there, so the wave fades out
// mid-board rather than slamming the far wall. Cells past REACH aren't drawn.
const DELAY_PER_UNIT = 0.03;
const BASE_DELAY = 0.2;
const REACH = 26;
const PEAK = 0.62;

// 8-connected so the flood reads as rounded rather than a diamond, but a
// diagonal step is barred when both orthogonal cells beside it are blocked — the
// same "can't squeeze through a diagonal gap" rule the runner obeys — so the
// wave can't leak through a corner-touching wall of pieces.
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
// square within REACH. The farthest-launching cell is flagged `last` so its
// animation end can retire the whole wave without a timer.
const floodCells = (blocks: ReadonlyArray<Point>): Cell[] => {
  const blocked = new Set(blocks.map((b) => key(b.x, b.y)));
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
      // No diagonal squeeze between two corner-touching pieces.
      if (
        dx && dy && blocked.has(key(x + dx, y)) && blocked.has(key(x, y + dy))
      ) {
        continue;
      }
      const nd = d + w;
      if (nd < (dist.get(key(nx, ny)) ?? Infinity)) {
        dist.set(key(nx, ny), nd);
        pq.push([nd, nx, ny]);
      }
    }
  }

  const cells: Cell[] = [];
  let maxDelay = -1;
  let lastIdx = 0;
  for (const [k, d] of dist) {
    if (d >= REACH) continue;
    const delay = BASE_DELAY + d * DELAY_PER_UNIT;
    cells.push({
      x: k % N,
      y: Math.floor(k / N),
      peak: PEAK * (1 - d / REACH),
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
  const { time, phase, blocks } = useContext(GameStateContext);
  const [waves, setWaves] = useState<Wave[]>([]);
  // Previous observed second, to fire only on a real tick DOWN across a mark —
  // not on the initial mount, nor on the jump back up when a fresh attempt
  // re-arms the clock to 60.
  const prev = useRef(time);
  const nextId = useRef(0);
  // `blocks` changes at pointer speed while building; read it off a ref so it
  // isn't a dependency of the mark effect (which must run only on a tick).
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  useEffect(() => {
    const before = prev.current;
    prev.current = time;
    if (phase !== "building") return;
    if (time >= before) return;
    // Largest mark newly crossed. A throttled background tab can skip several
    // marks in one tick; one wave for the batch is deliberate (mild).
    const mark = RIPPLE_MARKS.find((m) => before > m && time <= m);
    if (mark === undefined) return;
    const cells = floodCells(blocksRef.current);
    if (!cells.length) return;
    setWaves((w) => [...w, { id: nextId.current++, cells }]);
    // Cue the button's drop, in sync (it is the source).
    timerPulse.value++;
  }, [time, phase]);

  const remove = (id: number) => setWaves((w) => w.filter((x) => x.id !== id));

  if (waves.length === 0) return null;
  return (
    <svg class="board-ripple" viewBox="0 0 20 20" aria-hidden="true">
      {waves.map((wave) =>
        wave.cells.map((c) => (
          <rect
            key={`${wave.id}-${c.x}-${c.y}`}
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
        ))
      )}
    </svg>
  );
};
