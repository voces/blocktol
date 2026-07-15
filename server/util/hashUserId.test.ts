import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { hashUserId } from "./hashUserId.ts";

const ID = "690y0b2g025n4l0x624v2l533z5h433f";

Deno.test("hashUserId is deterministic", async () => {
  assertEquals(await hashUserId(ID), await hashUserId(ID));
});

Deno.test("hashUserId distinguishes different ids", async () => {
  assertNotEquals(await hashUserId("aaa"), await hashUserId("bbb"));
});

Deno.test("hashUserId never returns the raw id (not a credential)", async () => {
  const tag = await hashUserId(ID);
  assertNotEquals(tag, ID);
  assert(!tag.includes(ID));
});

Deno.test("hashUserId is 16 lowercase hex chars", async () => {
  assert(/^[0-9a-f]{16}$/.test(await hashUserId("whatever")));
});
