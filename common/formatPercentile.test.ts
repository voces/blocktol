import { test } from "node:test";
import { assertEquals } from "@std/assert";
import { formatPercentile } from "./formatPercentile.ts";

test("0", () => {
  assertEquals(formatPercentile(0), "0");
});

test("0.00000001", () => {
  assertEquals(formatPercentile(0.00000001), "0.000001");
});

test("0.000000014", () => {
  assertEquals(formatPercentile(0.000000014), "0.000001");
});

test("0.000000015", () => {
  assertEquals(formatPercentile(0.000000015), "0.000002");
});

test("0.09", () => {
  assertEquals(formatPercentile(0.09), "9");
});

test("0.091", () => {
  assertEquals(formatPercentile(0.091), "9");
});

test("0.095", () => {
  assertEquals(formatPercentile(0.095), "10");
});

test("0.1", () => {
  assertEquals(formatPercentile(0.1), "10");
});

test("0.104", () => {
  assertEquals(formatPercentile(0.104), "10");
});

test("0.105", () => {
  assertEquals(formatPercentile(0.105), "11");
});

test("0.984", () => {
  assertEquals(formatPercentile(0.984), "98");
});

test("0.985", () => {
  assertEquals(formatPercentile(0.985), "99");
});

test("0.99", () => {
  assertEquals(formatPercentile(0.99), "99");
});

test("0.994", () => {
  assertEquals(formatPercentile(0.994), "99.4");
});

test("0.995", () => {
  assertEquals(formatPercentile(0.995), "99.5");
});

test("0.999", () => {
  assertEquals(formatPercentile(0.999), "99.9");
});

test("0.9994", () => {
  assertEquals(formatPercentile(0.9994), "99.94");
});

test("0.99944", () => {
  assertEquals(formatPercentile(0.99944), "99.94");
});

test("0.99945", () => {
  assertEquals(formatPercentile(0.99945), "99.95");
});

test("0.9995", () => {
  assertEquals(formatPercentile(0.9995), "99.95");
});

test("0.9999", () => {
  assertEquals(formatPercentile(0.9999), "99.99");
});

test("0.99998", () => {
  assertEquals(formatPercentile(0.99998), "99.998");
});

test("0.999984", () => {
  assertEquals(formatPercentile(0.999984), "99.998");
});

test("0.999985", () => {
  assertEquals(formatPercentile(0.999985), "99.999");
});

test("1", () => {
  assertEquals(formatPercentile(1), "100");
});
