// type Iteration = {

import { Point } from "../../common/types.ts";
import { sql } from "./query.ts";

// }

export const getIterationCount = () =>
  sql<{ count: number }[]>`
    SELECT COUNT(*) count FROM iteration;
  `.then((r) => r[0].count);

export const getIteration = (id: number) =>
  sql<
    [
      {
        bricks: number;
        power: number;
        checkpoint_x: number;
        checkpoint_y: number;
      }[],
      { x: number; y: number; kind: "block" | "thunder" }[],
    ]
  >`
    SELECT bricks, power, checkpoint_x, checkpoint_y FROM iteration WHERE id = ${id};
    SELECT x, y, kind FROM block WHERE iteration = ${id};
  `.then(([[i], blocks]) => ({
    bricks: i.bricks,
    power: i.power,
    checkpoint: { x: i.checkpoint_x, y: i.checkpoint_y },
    blocks: blocks
      .filter((b) => b.kind === "block")
      .map(({ x, y }) => ({ x, y })),
    thunders: blocks
      .filter((b) => b.kind === "thunder")
      .map(({ x, y }) => ({ x, y })),
  }));

const raw = ({ raw }: { raw: readonly string[] }) => ({
  toSqlString: () => raw.join(""),
});

export const createIteration = (
  bricks: number,
  power: number,
  checkpoint: Point,
  blocks: Point[],
  thunders: Point[],
) =>
  sql`
    INSERT INTO iteration (bricks, power, checkpoint_x, checkpoint_y) 
    VALUES (${bricks}, ${power}, ${checkpoint.x}, ${checkpoint.y});
    SET @last_id = LAST_INSERT_ID();
    INSERT INTO block (iteration, x, y, kind)
    VALUES ${[
    ...blocks.map((b) => [raw`@last_id`, b.x, b.y, "block"]),
    ...thunders.map((t) => [raw`@last_id`, t.x, t.y, "thunder"]),
  ]};
  `;

export const getIterationTimes = (iteration: number) =>
  sql<{ time: number }[]>`
    SELECT time FROM run WHERE iteration = ${iteration} ORDER BY created DESC LIMIT 1000;
  `.then((r) => r.map((r) => r.time).sort((a, b) => a - b));
