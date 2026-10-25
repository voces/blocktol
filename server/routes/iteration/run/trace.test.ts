import { test } from "node:test";
import { assertEquals } from "@std/assert";
import { parseTraceBatch, traceLine } from "./trace.ts";

test("parseTraceBatch keeps a well-formed batch", () => {
  const batch = {
    p: "abc123",
    e: [[0, 1500, "p", 2, 2], [1, 900, "m", 2, 2, 4, 4], [2, 10, "u", 4, 4]],
  };
  assertEquals(parseTraceBatch(batch), batch);
});

test("parseTraceBatch drops what doesn't parse instead of throwing", () => {
  assertEquals(parseTraceBatch(undefined), undefined);
  assertEquals(parseTraceBatch("nope"), undefined);
  assertEquals(parseTraceBatch({ p: "x", e: [[0, 1, "m", 2, 2]] }), undefined);
  assertEquals(parseTraceBatch({ p: "x", e: [[0, 1, "p", 0, 2]] }), undefined);
  assertEquals(parseTraceBatch({ p: "x y", e: [] }), undefined);
});

test("traceLine completes the JSON the SQL opens", () => {
  const line = traceLine(3, 41.5, { p: "abc", e: [[0, 5, "p", 2, 2]] });
  assertEquals(JSON.parse(`{"s":1200,${line}`), {
    s: 1200,
    n: 3,
    d: 41.5,
    p: "abc",
    e: [[0, 5, "p", 2, 2]],
  });
  assertEquals(line.endsWith("}\n"), true);
  assertEquals(JSON.parse(`{"s":0,${traceLine(0, 30, undefined)}`), {
    s: 0,
    n: 0,
    d: 30,
  });
});
