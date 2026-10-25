import { test } from "node:test";
import { assertEquals } from "@std/assert";
import { healthCheck } from "./health.ts";

const call = async (check: () => Promise<boolean>) => {
  const res = await healthCheck(check)(new Request("http://x/health"), {});
  return [
    res!.status,
    (await res!.text()).trim(),
    res!.headers.get("cache-control"),
  ];
};

test("health: ok when today's puzzle exists", async () => {
  assertEquals(await call(() => Promise.resolve(true)), [
    200,
    "ok",
    "no-store",
  ]);
});

test("health: 503 when today's puzzle is missing", async () => {
  assertEquals(await call(() => Promise.resolve(false)), [
    503,
    "no puzzle for today",
    "no-store",
  ]);
});

test("health: 503 when the database fails", async () => {
  assertEquals(await call(() => Promise.reject(new Error("down"))), [
    503,
    "db unreachable",
    "no-store",
  ]);
});
