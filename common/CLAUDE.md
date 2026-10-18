# common/ — the pathing engine

Loaded when working under `common/`. The root `CLAUDE.md` covers the whole repo:
what the game is, commands, the import rule, and the domain invariants every
area relies on.

The single most important file; runs identically on server (authoritative
timing, generation, validation) and client (live preview). Do not let the two
diverge — the server's accepted time must equal what the client previewed.

- `PathSolver` is the one engine: an **exact any-angle shortest path** via a
  visibility graph over obstacle corners with Dijkstra — deliberately _not_
  Theta*, which can settle for slightly-longer routes; optimality is
  test-asserted against a brute-force full-cell visibility graph. `lineOfSight`
  is its swept-square (Liang–Barsky) oracle for the 1×1 runner against blocked
  cells: a segment may _touch_ an obstacle boundary (so a taut path can round a
  corner) but must never cross a blocked cell's interior. Because two
  diagonally-touching blocks leave only a zero-width gap, the runner cannot
  squeeze between them — asserted by the "refuses to squeeze a unit runner
  through a diagonal gap" test in `common/pathing.test.ts`.
- A solver instance precomputes its base board's corners and their pairwise
  visibility once, then each `solve(pieces)` pays only for what the pieces
  change, with a single Dijkstra rooted at the checkpoint settling both legs. On
  top sits an edit-stream layer exploiting that a build is the same maze ± one
  piece per save: recent results are memoized (sorted geometry + thunder flags)
  and a one-piece addition skips the search when the predecessor was unsolvable
  (always sound) or its path is untouched by the new piece (thunder-free boards
  only — the reuse can return a different equal-length path, and near thunders
  geometry is duration-visible). The engine is placement-order-independent by
  construction (ring corners sort row-major), and the layer's contract — a cold
  solver reproduces every warm duration exactly — is fuzz-asserted by the "edit
  stream" test. `cachedSolver` content-addresses one solver per base board
  (LRU); **every surface** — `validateRun`, board/daily/start staging, the
  client's `localRun` preview and its hover/drag validity probes (`solvable`),
  and board generation — goes through the same class, so previewed and persisted
  times share one engine _and one tie-breaking_.
- `pathDuration` turns a path + thunders into `[time, slows]`, **continuously**
  — an event-driven walk (circle/segment in-range intervals, piecewise-linear
  time), not a stepped simulation, so duration is a smooth function of the maze
  rather than being quantized to 0.1-distance ticks. The runner moves at `SPEED`
  (halved while slowed); a thunder within radius 4 triggers at the earliest
  instant strictly in range with its 3.2s cooldown passed, resetting the shared
  6s slow (never stacking); exact ties fire together. Times round to the two
  decimals the game stores. Range is pure geometry (`circleWindows`: a thunder's
  trigger windows as circle/polyline intersections in distance along the path),
  and between events the distance-to-time map is linear, so the walk advances
  event to event in closed form.
- Placement legality lives in `server/util/validateRun.ts` (`validateRun`) — it
  reuses the same engine (via `cachedSolver`, per iteration shape), so what the
  audit script accepts is exactly what the write path accepts. It first rejects
  any piece whose anchor isn't a whole cell in `1..17` (a piece is 2×2, so that
  keeps it off the border ring) — the solver reads an off-grid cell as free, so
  this can't be left to it; the run endpoints' shared zod `piece` schema
  (`routes/iteration/run/piece.ts`) enforces the same bounds. Any change that
  shifts timing or equal-length tie-breaking requires a
  `scripts/comparePathing.ts` audit/retime before it ships.
