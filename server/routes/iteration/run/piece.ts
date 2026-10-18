import { z } from "zod";
import { PIECE_MAX, PIECE_MIN } from "../../../util/validateRun.ts";

// One player piece as the run endpoints accept it: whole-cell anchors inside
// the placeable range. A bare `z.number()` would pass fractional or off-board
// pieces to the solver, which reads an out-of-grid cell as free. validateRun
// re-checks the same bounds.
const coord = z.number().int().min(PIECE_MIN).max(PIECE_MAX);

export const pieceCoords = z.object({ x: coord, y: coord });

export const piece = pieceCoords.extend({ thunder: z.boolean().optional() });
