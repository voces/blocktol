import { assertEquals } from "@std/assert";
import { primePool } from "./primePool.ts";

const clock = () => {
  let t = 0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

Deno.test("a prime is taken once, within its window", () => {
  const c = clock();
  const pool = primePool<string>(10_000, c.now);
  pool.set("standings:{}", "fresh");
  c.advance(9_000);
  assertEquals(pool.take("standings:{}"), "fresh");
  assertEquals(pool.take("standings:{}"), undefined);
});

Deno.test("a prime left unconsumed past its window is discarded", () => {
  const c = clock();
  const pool = primePool<string>(10_000, c.now);
  pool.set("standings:{}", "stale");
  c.advance(10_001);
  assertEquals(pool.take("standings:{}"), undefined);
});

Deno.test("touch restarts the window of the value still primed", () => {
  const c = clock();
  const pool = primePool<string>(10_000, c.now);
  pool.set("k", "slow");
  c.advance(9_000);
  pool.touch("k", "slow"); // the response arrived
  pool.touch("k", "other"); // a value no longer primed changes nothing
  c.advance(9_000);
  assertEquals(pool.take("k"), "slow");
});

Deno.test("re-priming a key restarts its window", () => {
  const c = clock();
  const pool = primePool<string>(10_000, c.now);
  pool.set("k", "first");
  c.advance(8_000);
  pool.set("k", "second");
  c.advance(8_000);
  assertEquals(pool.take("k"), "second");
});
