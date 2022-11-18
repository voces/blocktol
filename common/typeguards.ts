export type GuardedType<T> = T extends (value: unknown) => value is infer U ? U
  : never;

export const isClass =
  <T extends { new (): unknown }>(Class: T) =>
  (value: unknown): value is InstanceType<T> =>
    typeof value === "object" && value instanceof Class;

export const isError = isClass(Error);

export const isString = (value: unknown): value is string =>
  typeof value === "string";

export const isNumber = (value: unknown): value is number =>
  typeof value === "number";

export const isBoolean = (value: unknown): value is boolean =>
  typeof value === "boolean";

export const isNull = (value: unknown): value is null => value === null;

export const isUndefined = (value: unknown): value is undefined =>
  value === undefined;

export const isUnknown = (_value: unknown): _value is unknown => true;

export const isRecord =
  <T>(typeguard: (value: unknown) => value is T) =>
  (value: unknown): value is Record<string, T> =>
    !!value && typeof value === "object" &&
    Object.values(value).every(typeguard);

export const isObject = <T>(
  props: { [Prop in keyof T]: (value: unknown) => value is T[Prop] },
) =>
(value: unknown): value is T => {
  if (!is.record(is.unknown)(value)) return false;
  for (const prop in props) if (!props[prop](value[prop])) return false;
  return true;
};

export const isConst =
  <T extends string | boolean | number>(constValue: T) =>
  (value: unknown): value is T => value === constValue;

export const isEqual = <T>(constValue: T) => (value: unknown): value is T =>
  value === constValue;

export const isArray =
  <T>(typeguard: (value: unknown) => value is T) =>
  (value: unknown): value is T[] =>
    Array.isArray(value) && value.every(typeguard);

export const isIn = <T extends string | boolean | number>(...options: T[]) =>
// deno-lint-ignore no-explicit-any
(value: unknown): value is T => options.includes(value as any);

type union = {
  <A, B>(
    typeguardA: (value: unknown) => value is A,
    typeguardB: (value: unknown) => value is B,
  ): (value: unknown) => value is A | B;
  <A, B, C>(
    typeguardA: (value: unknown) => value is A,
    typeguardB: (value: unknown) => value is B,
    typeguardC: (value: unknown) => value is C,
  ): (value: unknown) => value is A | B | C;
  <A, B, C, D>(
    typeguardA: (value: unknown) => value is A,
    typeguardB: (value: unknown) => value is B,
    typeguardC: (value: unknown) => value is C,
    typeguardD: (value: unknown) => value is D,
  ): (value: unknown) => value is A | B | C | D;
  <A, B, C, D, E>(
    typeguardA: (value: unknown) => value is A,
    typeguardB: (value: unknown) => value is B,
    typeguardC: (value: unknown) => value is C,
    typeguardD: (value: unknown) => value is D,
    typeguardE: (value: unknown) => value is E,
  ): (value: unknown) => value is A | B | C | D | E;
  <A, B, C, D, E, F>(
    typeguardA: (value: unknown) => value is A,
    typeguardB: (value: unknown) => value is B,
    typeguardC: (value: unknown) => value is C,
    typeguardD: (value: unknown) => value is D,
    typeguardE: (value: unknown) => value is E,
    typeguardF: (value: unknown) => value is F,
  ): (value: unknown) => value is A | B | C | D | E;
  <T>(
    ...typeguards: ((value: unknown) => value is T)[]
  ): (value: unknown) => value is T;
};

export const isUnion = (<T>(
  ...typeguards: ((value: unknown) => value is T)[]
) =>
(value: unknown): value is T => typeguards.some((tg) => tg(value))) as union;

type tuple = {
  <A>(
    typeguardA: (value: unknown) => value is A,
  ): (value: unknown) => value is [A];
  <A, B>(
    typeguardA: (value: unknown) => value is A,
    typeguardB: (value: unknown) => value is B,
  ): (value: unknown) => value is [A, B];
  <A, B, C>(
    typeguardA: (value: unknown) => value is A,
    typeguardB: (value: unknown) => value is B,
    typeguardC: (value: unknown) => value is C,
  ): (value: unknown) => value is [A, B, C];
  <A, B, C, D>(
    typeguardA: (value: unknown) => value is A,
    typeguardB: (value: unknown) => value is B,
    typeguardC: (value: unknown) => value is C,
    typeguardD: (value: unknown) => value is D,
  ): (value: unknown) => value is [A, B, C, D];
  <A, B, C, D, E>(
    typeguardA: (value: unknown) => value is A,
    typeguardB: (value: unknown) => value is B,
    typeguardC: (value: unknown) => value is C,
    typeguardD: (value: unknown) => value is D,
    typeguardE: (value: unknown) => value is E,
  ): (value: unknown) => value is [A, B, C, D, E];
  <A, B, C, D, E, F>(
    typeguardA: (value: unknown) => value is A,
    typeguardB: (value: unknown) => value is B,
    typeguardC: (value: unknown) => value is C,
    typeguardD: (value: unknown) => value is D,
    typeguardE: (value: unknown) => value is E,
    typeguardF: (value: unknown) => value is F,
  ): (value: unknown) => value is [A, B, C, D, E];
  <T extends unknown[]>(
    ...typeguards: ((value: unknown) => value is T[number])[]
  ): (value: unknown) => value is T;
};

export const isTuple = (<T extends unknown[]>(
  ...typeguards: ((value: unknown) => value is T[number])[]
) =>
(values: unknown): values is T =>
  Array.isArray(values) &&
  typeguards.length === values.length &&
  typeguards.every((tg, i) => tg(values[i]))) as tuple;

export const is = {
  string: isString,
  number: isNumber,
  boolean: isBoolean,
  null: isNull,
  undefined: isUndefined,
  unknown: isUnknown,
  record: isRecord,
  object: isObject,
  const: isConst,
  equal: isEqual,
  array: isArray,
  union: isUnion,
  in: isIn,
  tuple: isTuple,
};

export const isPoint = is.object({ x: is.number, y: is.number });
