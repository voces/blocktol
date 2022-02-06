import { Point } from "./types.ts";

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object";

// const isArray = (v: unknown): v is Array<unknown> => Array.isArray(v);
// const isString = (v: unknown): v is string => typeof v === "string";
// const isNumber = (v: unknown): v is number => typeof v === "number";

export const has = <T extends Record<string, unknown>, K extends string, U>(
  v: T,
  k: K,
  typeguard: (v: unknown) => v is U,
): v is T & { [k in K]: U } => k in v && typeguard(v[k]);

export const hasNumber = <T extends Record<string, unknown>, K extends string>(
  v: T,
  k: K,
): v is T & { [k in K]: number } => k in v && typeof v[k] === "number";

export const hasString = <T extends Record<string, unknown>, K extends string>(
  v: T,
  k: K,
): v is T & { [k in K]: string } => k in v && typeof v[k] === "string";

export const hasMaybeString = <
  T extends Record<string, unknown>,
  K extends string,
>(
  v: T,
  k: K,
): v is T & { [k in K]: string | undefined } =>
  k in v ? (typeof v[k] === "string" || v[k] === undefined) : true;

// const hasMaybeNumber = <
//   T extends Record<string, unknown>,
//   K extends string,
// >(
//   v: T,
//   k: K,
// ): v is T & { [k in K]: string | undefined } =>
//   k in v ? (typeof v[k] === "number" || v[k] == null) : true;

// const isStringArray = (v: unknown): v is string[] =>
//   Array.isArray(v) && v.every((v) => typeof v === "string");

export const hasEnum = <
  T extends Record<string, unknown>,
  P extends string,
  V,
>(
  value: T,
  property: P,
  enumm: V[],
): value is T & { [p in P]: V } =>
  // deno-lint-ignore no-explicit-any
  enumm.includes((value as any)[property]);

// const isArrayOf = <T>(
//   v: unknown,
//   typeguard: (v: unknown) => v is T,
// ): v is T[] => Array.isArray(v) && v.every(typeguard);

export const arrayOf = <T>(
  typeguard: (v: unknown) => v is T,
) => (v: unknown): v is T[] => Array.isArray(v) && v.every(typeguard);

export const isPoint = (value: unknown): value is Point =>
  isRecord(value) && hasNumber(value, "x") && hasNumber(value, "y");
