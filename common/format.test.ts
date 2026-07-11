import { assertEquals } from "@std/assert";
import { formatCount, formatDecimal, formatSeconds } from "./format.ts";

// An explicit locale is passed so the assertions don't depend on the host's
// default locale; the `undefined` (viewer/runtime) path is exercised by the
// separator-agnostic shape checks below.

Deno.test("formatSeconds pins two decimals by default", () => {
  assertEquals(formatSeconds(35.1, { locale: "en-US" }), "35.10");
  assertEquals(formatSeconds(30, { locale: "en-US" }), "30.00");
  assertEquals(formatSeconds(29.62, { locale: "en-US" }), "29.62");
});

Deno.test("formatSeconds localizes the decimal separator", () => {
  assertEquals(formatSeconds(35.1, { locale: "de-DE" }), "35,10");
  // A one-decimal bound still localizes the separator.
  assertEquals(
    formatSeconds(21.4, { min: 1, max: 1, locale: "de-DE" }),
    "21,4",
  );
});

Deno.test("formatSeconds never groups (mono time columns stay aligned)", () => {
  // A four-digit whole part must not gain a thousands separator.
  assertEquals(formatSeconds(1234.5, { locale: "en-US" }), "1234.50");
});

Deno.test("formatSeconds with min 0 keeps a variable-precision look", () => {
  assertEquals(formatSeconds(35, { min: 0, locale: "en-US" }), "35");
  assertEquals(formatSeconds(35.1, { min: 0, locale: "en-US" }), "35.1");
  assertEquals(formatSeconds(35.12, { min: 0, locale: "en-US" }), "35.12");
});

Deno.test("formatDecimal drops trailing zeros, no grouping", () => {
  assertEquals(formatDecimal(1.9, { min: 0, max: 1, locale: "en-US" }), "1.9");
  assertEquals(formatDecimal(2, { min: 0, max: 1, locale: "en-US" }), "2");
  assertEquals(formatDecimal(1.5, { min: 1, max: 1, locale: "de-DE" }), "1,5");
});

Deno.test("formatCount groups thousands by locale", () => {
  assertEquals(formatCount(1900, "en-US"), "1,900");
  assertEquals(formatCount(1900, "de-DE"), "1.900");
  assertEquals(formatCount(42, "en-US"), "42");
});

Deno.test("a malformed locale falls back to the runtime default", () => {
  // Must not throw — a bad stored locale can't break push rendering.
  const out = formatSeconds(35.1, { locale: "not a locale!!" });
  assertEquals(typeof out, "string");
  assertEquals(out.length > 0, true);
});
