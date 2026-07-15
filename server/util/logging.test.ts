import { assert, assertEquals } from "@std/assert";
import { coerceFlat, errText, formatLogfmt } from "./logging.ts";

Deno.test("formatLogfmt: flat scalars, bare where safe", () => {
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

Deno.test("formatLogfmt: quotes values (and the msg) with spaces", () => {
  assertEquals(
    formatLogfmt("error", "handler failed", { error: "bad input" }),
    'level=error msg="handler failed" error="bad input"',
  );
});

Deno.test("formatLogfmt: escapes newlines so a stack stays one line", () => {
  const line = formatLogfmt("error", "boom", { error: "a\nb" });
  assertEquals(line, 'level=error msg=boom error="a\\nb"');
  assert(!line.includes("\n"));
});

Deno.test("formatLogfmt: drops null/undefined fields", () => {
  assertEquals(
    formatLogfmt("info", "m", { a: 1, b: undefined, c: null, d: "x" }),
    "level=info msg=m a=1 d=x",
  );
});

Deno.test("errText: Error yields its stack (incl. message); else stringifies", () => {
  const e = new Error("boom");
  assert(errText(e).includes("boom"));
  assertEquals(errText("plain"), "plain");
  assertEquals(errText(42), "42");
});

Deno.test("coerceFlat: primitives pass, objects stringify, Errors flatten", () => {
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
