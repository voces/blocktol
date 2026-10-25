import { test } from "node:test";
import { assertEquals } from "@std/assert";
import { withSecurityHeaders } from "./securityHeaders.ts";

test("withSecurityHeaders stamps a plain response", async () => {
  const res = withSecurityHeaders(new Response("hi", { status: 201 }));
  assertEquals(res.status, 201);
  assertEquals(await res.text(), "hi");
  assertEquals(res.headers.get("x-content-type-options"), "nosniff");
  assertEquals(res.headers.get("referrer-policy"), "no-referrer");
  assertEquals(res.headers.get("x-frame-options"), "DENY");
});

test("withSecurityHeaders re-wraps immutable headers", () => {
  const res = withSecurityHeaders(Response.redirect("https://x.test/", 302));
  assertEquals(res.status, 302);
  assertEquals(res.headers.get("location"), "https://x.test/");
  assertEquals(res.headers.get("x-frame-options"), "DENY");
});
