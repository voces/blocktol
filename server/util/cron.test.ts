import { test } from "node:test";
import { assert, assertEquals } from "@std/assert";
import { schedule } from "./cron.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("schedule runs on UTC whatever the host's zone", () => {
  const job = schedule("utc-probe", "30 * * * *", () => Promise.resolve());
  try {
    // Pinned, not the host's zone: rate-dailies' :30 is a UTC half-hour.
    const next = job.nextRun(new Date("2026-03-01T10:05:00Z"));
    assertEquals(next?.toISOString(), "2026-03-01T10:30:00.000Z");
  } finally {
    job.stop();
  }
});

test("a run still going when the next is due skips that one", async () => {
  let started = 0;
  let release!: () => void;
  const held = new Promise<void>((r) => release = r);
  const job = schedule("overlap-probe", "* * * * * *", async () => {
    started++;
    await held;
  });
  try {
    // At least two per-second triggers fall in this window.
    await sleep(2_300);
    assertEquals(started, 1);
  } finally {
    job.stop();
    release();
  }
});

test("a throwing run is contained and the schedule carries on", async () => {
  let runs = 0;
  const job = schedule("throw-probe", "* * * * * *", () => {
    runs++;
    return Promise.reject(new Error("boom"));
  });
  try {
    await sleep(2_300);
    assert(runs >= 2, `expected the schedule to keep firing, got ${runs}`);
  } finally {
    job.stop();
  }
});
