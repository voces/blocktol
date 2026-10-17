import { assertEquals } from "@std/assert";
import { drain } from "./retention.ts";

const batches = (counts: number[]) => {
  const calls: number[] = [];
  return {
    calls,
    batch: () => {
      const n = counts[calls.length] ?? 0;
      calls.push(n);
      return Promise.resolve(n);
    },
  };
};

Deno.test("drain stops at the first short batch", async () => {
  const b = batches([10, 10, 3, 10]);
  assertEquals(await drain(b.batch, 10, 20), 23);
  assertEquals(b.calls, [10, 10, 3]);
});

Deno.test("drain stops after maxBatches full batches", async () => {
  const b = batches([10, 10, 10, 10]);
  assertEquals(await drain(b.batch, 10, 2), 20);
  assertEquals(b.calls.length, 2);
});

Deno.test("drain runs once on an empty table", async () => {
  const b = batches([]);
  assertEquals(await drain(b.batch, 10, 20), 0);
  assertEquals(b.calls, [0]);
});
