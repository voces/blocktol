import { assertEquals } from "@std/assert";
import { drainJobs, tracked } from "./shutdown.ts";

Deno.test("drain waits for a running job, then refuses new ones", async () => {
  const log: string[] = [];
  const slow = tracked("slow", async () => {
    await new Promise((r) => setTimeout(r, 50));
    log.push("slow done");
  });
  const running = slow();
  await drainJobs(1_000);
  log.push("drained");
  await running;

  await tracked("late", async () => {
    log.push("late ran");
  })();
  assertEquals(log, ["slow done", "drained"]);
});
