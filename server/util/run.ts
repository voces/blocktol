import { Point } from "../../common/types.ts";

export const serializeRun = (
  blocks: (Point & { thunder?: boolean; player?: boolean })[],
) =>
  blocks.filter((b) => b.player).map((b) =>
    `${b.thunder ? "t" : ""}${b.x.toString().padStart(2, "0")}${b.y}`
  ).join("\n");

export const deserializeRun = (run: string) =>
  run.split("\n").filter((r) => r.length).map(
    (r): { x: number; y: number; thunder?: boolean } => {
      let isThunder = false;
      if (r[0] === "t") {
        isThunder = true;
        r = r.slice(1);
      }
      const x = parseInt(r.slice(0, 2));
      const y = parseInt(r.slice(2));
      if (isThunder) return { x, y, thunder: true };
      else return { x, y };
    },
  );
