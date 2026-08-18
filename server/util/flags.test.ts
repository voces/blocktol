import { assertEquals } from "@std/assert";
import { deserializeFlags, serializeFlags } from "./flags.ts";

Deno.test("flags round-trip through the stored column", () => {
  // Fixed-width records: both coordinates are zero-padded, so a single-digit
  // one can't run into the next field (the maze blob's format packs x and y the
  // same way — see util/run.ts).
  const flags = [{ x: 1, y: 18 }, { x: 9, y: 4 }, { x: 12, y: 12 }];
  assertEquals(serializeFlags(flags), "0118\n0904\n1212");
  assertEquals(deserializeFlags(serializeFlags(flags)), flags);
});

Deno.test("an empty or damaged column reads as no flags", () => {
  assertEquals(serializeFlags([]), "");
  assertEquals(deserializeFlags(""), []);
  // A truncated record is dropped rather than parsed into a NaN cell.
  assertEquals(deserializeFlags("011\n\n0904"), [{ x: 9, y: 4 }]);
});
