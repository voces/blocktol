import { assertEquals } from "@std/assert";
import { redactPath } from "./beginLogger.ts";

Deno.test("redactPath hides a sign-in link's credential", () => {
  assertEquals(redactPath("/l/abc123"), "/l/:id");
  assertEquals(redactPath("/login/abc-123"), "/login/:id");
  // The query and fragment go too — nothing after the id is trustworthy.
  assertEquals(redactPath("/l/abc?x=1"), "/l/:id");
  assertEquals(redactPath("/l/"), "/l/:id");
});

Deno.test("redactPath leaves every other path alone", () => {
  for (
    const p of [
      "/",
      "/api/boot",
      "/logo.png",
      "/login.html",
      "/20260101?board=pb",
      "/js/l/x.js",
    ]
  ) assertEquals(redactPath(p), p);
});
