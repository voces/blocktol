import { Point } from "../../common/types.ts";
import { ExecResult, format, sql } from "./query.ts";

export const getIterationCount = () =>
  sql<{ count: number }[]>`
    SELECT COUNT(*) count FROM iteration;
  `.then((r) => r[0].count);

export const getIteration = (id: number) =>
  sql<
    [
      {
        id: number;
        bricks: number;
        created: string;
        power: number;
        checkpoint_x: number;
        checkpoint_y: number;
        min: number;
      }[],
      { x: number; y: number; kind: "block" | "thunder" }[],
    ]
  >`
    SELECT id, bricks, created, power, checkpoint_x, checkpoint_y, min FROM iteration WHERE id = ${id};
    SELECT x, y, kind FROM block WHERE iteration = ${id};
  `.then(([[i], blocks]) => {
    if (!i) throw new Error(`Iteration ${id} does not exist`);

    return ({
      iteration: i.id,
      date: i.created,
      bricks: i.bricks,
      power: i.power,
      checkpoint: { x: i.checkpoint_x, y: i.checkpoint_y },
      blocks: blocks
        .filter((b) => b.kind === "block")
        .map(({ x, y }) => ({ x, y })),
      thunders: blocks
        .filter((b) => b.kind === "thunder")
        .map(({ x, y }) => ({ x, y })),
      min: i.min,
    });
  });

const raw = ({ raw }: { raw: readonly string[] }) => ({
  toSqlString: () => raw.join(""),
});

const raw2 = (str: string) => ({
  toSqlString: () => str,
});

export const createIteration = (
  date: Date,
  bricks: number,
  power: number,
  checkpoint: Point,
  blocks: Point[],
  thunders: Point[],
  duration: number,
) =>
  sql<[ExecResult, ExecResult, ExecResult[] | undefined]>`
    INSERT INTO iteration (created, bricks, power, checkpoint_x, checkpoint_y, min) 
    VALUES (${date}, ${bricks}, ${power}, ${checkpoint.x}, ${checkpoint.y}, ${duration});
    SET @last_id = LAST_INSERT_ID();
    ${
    raw2(format`
      INSERT INTO block (iteration, x, y, kind)
      VALUES ${[
      ...blocks.map((b) => [raw`@last_id`, b.x, b.y, "block"]),
      ...thunders.map((t) => [raw`@last_id`, t.x, t.y, "thunder"]),
    ]};`)
  }`.then(([q]) => q.insertId);

export const getMaxIterationTime = (iteration: number) =>
  sql<{ max: number }[] | undefined>`
    SELECT MAX(time) max FROM run WHERE iteration = ${iteration};
  `.then((r) => r?.[0]?.max);

export const getIterationTimeCounts = (iteration: number, dailyOnly = true) =>
  sql<{ time: number; count: number }[]>`
      SELECT time, COUNT(1) count
      FROM run
      WHERE iteration = ${iteration}
        AND daily = ${dailyOnly}
        AND void = FALSE
      GROUP BY 1
      ORDER BY time;`;

export const logRun = (
  iteration: number,
  user: string,
  duration: number,
  voidRun: boolean,
  data: string,
) =>
  sql`
    INSERT INTO run (user, iteration, time, void, data)
    VALUES (${user}, ${iteration}, ${duration}, ${voidRun}, ${data});`;

export const getDailyIterationId = (year: number, month: number, day: number) =>
  sql<{ id: number }[]>`
    SELECT id
    FROM iteration
    WHERE YEAR(created) = ${year}
      AND MONTH(created) = ${month}
      AND DAY(created) = ${day}
    LIMIT 1`.then((r) => r[0]?.id);

export const getDailyIteration = (year: number, month: number, day: number) =>
  getDailyIterationId(year, month, day).then((id) =>
    id ? getIteration(id) : undefined
  );

export const getIterationOtherBest = (
  iteration: number,
  user: string,
  daily = false,
) =>
  sql<{ otherBest: number | null }[]>`
    SELECT MAX(time) otherBest
    FROM run
    WHERE iteration = ${iteration}
      AND user != ${user}
      ${daily ? `AND daily = true` : ""};
  `.then((r) => r[0].otherBest);
