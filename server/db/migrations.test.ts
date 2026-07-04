import { assertEquals, assertThrows } from "@std/assert";
import {
  type Migration,
  migrations,
  pendingMigrations,
  validateMigrations,
} from "./migrations.ts";

const at = (...versions: number[]): Migration[] =>
  versions.map((version) => ({ version, name: `m${version}`, up: "" }));

Deno.test("migrations list is well-formed", () => {
  // The real list must always validate (contiguous from 1).
  validateMigrations();
  assertEquals(migrations[0].version, 1);
});

Deno.test("validateMigrations", async (t) => {
  await t.step("accepts a contiguous run and returns it sorted", () => {
    assertEquals(validateMigrations(at(3, 1, 2)).map((m) => m.version), [
      1,
      2,
      3,
    ]);
  });

  await t.step("rejects a gap", () => {
    assertThrows(() => validateMigrations(at(1, 3)), Error, "contiguous");
  });

  await t.step("rejects a duplicate version", () => {
    assertThrows(() => validateMigrations(at(1, 2, 2)), Error, "contiguous");
  });

  await t.step("rejects a list that doesn't start at 1", () => {
    assertThrows(() => validateMigrations(at(2, 3)), Error, "contiguous");
  });
});

Deno.test("pendingMigrations", async (t) => {
  const all = at(1, 2, 3);

  await t.step("a fresh database gets everything, in order", () => {
    assertEquals(pendingMigrations(0, all).map((m) => m.version), [1, 2, 3]);
  });

  await t.step("a partially-migrated database gets only the remainder", () => {
    assertEquals(pendingMigrations(2, all).map((m) => m.version), [3]);
  });

  await t.step("an up-to-date database gets nothing", () => {
    assertEquals(pendingMigrations(3, all), []);
  });
});
