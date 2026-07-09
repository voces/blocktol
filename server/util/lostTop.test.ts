import { assertEquals } from "@std/assert";
import { type BestRow, decideLostTop } from "./lostTop.ts";

const rows = (...pairs: [string, number][]): BestRow[] =>
  pairs.map(([user, best]) => ({ user, name: user, best }));

Deno.test("decideLostTop: passing the sole leader notifies them", () => {
  // "me" had 30, now builds 55, passing "a" (50).
  const d = decideLostTop(rows(["me", 55], ["a", 50]), "me", 30);
  assertEquals(d.passer, { name: "me", time: 55 });
  assertEquals(d.recipients, [{ user: "a", yourTime: 50, tied: false }]);
});

Deno.test("decideLostTop: passing a tied top notifies every co-leader", () => {
  const d = decideLostTop(rows(["me", 60], ["a", 50], ["b", 50]), "me", 10);
  assertEquals(d.recipients, [
    { user: "a", yourTime: 50, tied: false },
    { user: "b", yourTime: 50, tied: false },
  ]);
});

Deno.test("decideLostTop: tying a sole leader notifies them as a tie", () => {
  const d = decideLostTop(rows(["me", 50], ["a", 50]), "me", 30);
  assertEquals(d.passer, { name: "me", time: 50 });
  assertEquals(d.recipients, [{ user: "a", yourTime: 50, tied: true }]);
});

Deno.test("decideLostTop: tying an already-tied top notifies no one", () => {
  // "a" and "b" already share 50; "me" joins at 50 — nobody dropped from #1.
  const d = decideLostTop(rows(["me", 50], ["a", 50], ["b", 50]), "me", 20);
  assertEquals(d, { passer: null, recipients: [] });
});

Deno.test("decideLostTop: extending an existing lead notifies no one", () => {
  // "me" already led at 60 (prev best 60), now builds 70; "a" (50) was never #1.
  const d = decideLostTop(rows(["me", 70], ["a", 50]), "me", 60);
  assertEquals(d, { passer: null, recipients: [] });
});

Deno.test("decideLostTop: a build that doesn't beat your own best is a no-op", () => {
  // "me" prev 55, new run only 40 — the field top (a=50) is untouched by it.
  const d = decideLostTop(rows(["me", 55], ["a", 50]), "me", 55);
  assertEquals(d, { passer: null, recipients: [] });
});

Deno.test("decideLostTop: a build below the top notifies no one", () => {
  // "me" improves from 20 to 45 but "a" still leads at 50.
  const d = decideLostTop(rows(["me", 45], ["a", 50]), "me", 20);
  assertEquals(d, { passer: null, recipients: [] });
});

Deno.test("decideLostTop: co-leader (T1 with actor) passed, drops to #2", () => {
  // "me" and "a" were tied at 50 (myPrev 50); "me" now builds 55, passing "a".
  const d = decideLostTop(rows(["me", 55], ["a", 50]), "me", 50);
  assertEquals(d.recipients, [{ user: "a", yourTime: 50, tied: false }]);
});

Deno.test("decideLostTop: first player of the day notifies no one", () => {
  const d = decideLostTop(rows(["me", 40]), "me", null);
  assertEquals(d, { passer: null, recipients: [] });
});
