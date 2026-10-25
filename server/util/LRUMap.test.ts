import { test } from "node:test";
import { assertEquals } from "@std/assert";
import { LRUMap } from "./LRUMap.ts";

const values = Array.from(Array(15), (_, i) => i);

test("set", async (it) => {
  await it.test("simple", () => {
    const map = new LRUMap({ maxSize: 10 });
    for (const value of values) map.set(value, true);

    assertEquals(map.size, 10);
    assertEquals(Array.from(map.keys()), values.slice(5));
  });

  await it.test("weaved", () => {
    const map = new LRUMap({ maxSize: 3 });
    map.set(1, true);
    map.set(2, true);
    map.set(3, true);
    map.set(1, true);
    map.set(4, true);

    assertEquals(Array.from(map.keys()), [3, 1, 4]);
  });
});

test("get", () => {
  const map = new LRUMap({ maxSize: 3 });
  map.set(1, true);
  map.set(2, true);
  map.set(3, true);
  map.get(1);
  map.set(4, true);

  assertEquals(Array.from(map.keys()), [3, 1, 4]);
});

test("has", () => {
  const map = new LRUMap({ maxSize: 3 });
  map.set(1, true);
  map.set(2, true);
  map.set(3, true);
  map.has(1);
  map.set(4, true);

  assertEquals(Array.from(map.keys()), [3, 1, 4]);
});
