import { assert } from "std/testing/asserts.ts";

export const assertBetween = (actual: number, min: number, max: number) => {
  assert(
    min <= actual && actual <= max,
    `Expected ${actual} to be between ${min} and ${max}.`,
  );
};

export const assertAbout = (
  actual: number,
  expected: number,
  precision = 7,
) => {
  const range = 0.1 ** precision;
  assert(
    Math.abs(actual - expected) < range,
    `Expected ${actual} to be ${expected} ± ${range.toPrecision(1)}`,
  );
};
