import { test } from "node:test";
import { assert, assertEquals } from "@std/assert";
import { coerceFlat, errText, formatLogfmt } from "./logging.ts";

test("formatLogfmt: flat scalars, bare where safe", () => {
  assertEquals(
    formatLogfmt("info", "request", {
      method: "POST",
      status: 200,
      route: "/api/boot",
      ms: 13,
    }),
    "level=info msg=request method=POST status=200 route=/api/boot ms=13",
  );
});

test("formatLogfmt: quotes values (and the msg) with spaces", () => {
  assertEquals(
    formatLogfmt("error", "handler failed", { error: "bad input" }),
    'level=error msg="handler failed" error="bad input"',
  );
});

test("formatLogfmt: escapes newlines so a stack stays one line", () => {
  const line = formatLogfmt("error", "boom", { error: "a\nb" });
  assertEquals(line, 'level=error msg=boom error="a\\nb"');
  assert(!line.includes("\n"));
});

test("formatLogfmt: a key can't forge fields or break the line", () => {
  assertEquals(
    formatLogfmt("error", "m", { 'a b="x" c': 1, "": 2, "client.ok-1": 3 }),
    "level=error msg=m a_b__x__c=1 _=2 client.ok-1=3",
  );
});

test("formatLogfmt: drops null/undefined fields", () => {
  assertEquals(
    formatLogfmt("info", "m", { a: 1, b: undefined, c: null, d: "x" }),
    "level=info msg=m a=1 d=x",
  );
});

test("errText: Error yields its stack (incl. message); else stringifies", () => {
  const e = new Error("boom");
  assert(errText(e).includes("boom"));
  assertEquals(errText("plain"), "plain");
  assertEquals(errText(42), "42");
});

test("coerceFlat: primitives pass, objects stringify, Errors flatten", () => {
  const out = coerceFlat({
    a: 1,
    b: "x",
    nested: { x: 1 },
    err: new Error("boom"),
    z: null,
  });
  assertEquals(out.a, 1);
  assertEquals(out.b, "x");
  assertEquals(out.nested, '{"x":1}');
  assert(typeof out.err === "string" && out.err.includes("boom"));
  assertEquals(out.z, null);
});
