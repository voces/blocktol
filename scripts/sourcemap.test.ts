import { test } from "node:test";
import { assertEquals } from "@std/assert";
import { decodeMappings, originalPosition } from "./sourcemap.ts";

// "AAAA" = [0,0,0,0]; "QAAQ" = [8,0,0,8] (Q is 16 → +8); "AACA" = line +1.
const map = {
  sources: ["a.ts", "b.ts"],
  names: ["go"],
  mappings: "AAAA,QAAQ;AACA,ICCAA",
};
const decoded = decodeMappings(map.mappings);

test("originalPosition maps to the nearest mapping at or before", () => {
  assertEquals(originalPosition(map, decoded, 1, 1), {
    source: "a.ts",
    line: 1,
    column: 1,
    name: undefined,
  });
  // Column 12 (1-based) sits after the segment at generated column 8.
  assertEquals(originalPosition(map, decoded, 1, 12)?.column, 9);
  assertEquals(originalPosition(map, decoded, 2, 1)?.line, 2);
});

test("source index and name deltas carry across segments", () => {
  // "ICCAA": col +4, source +1 (b.ts), line +1, col +0, name +0 (go). The
  // source column stays 8 from "QAAQ"; only the generated column resets per
  // line.
  assertEquals(originalPosition(map, decoded, 2, 5), {
    source: "b.ts",
    line: 3,
    column: 9,
    name: "go",
  });
});

test("no mapping before the column, or no such line, is null", () => {
  assertEquals(originalPosition(map, decodeMappings("IAAA"), 1, 1), null);
  assertEquals(originalPosition(map, decoded, 9, 1), null);
});
