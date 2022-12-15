import { getDailyIteration } from "../db/iteration.ts";
import { newIteration } from "./newIteration.ts";

const ONE_MINUTE = 1_000 * 60;
const ONE_DAY = ONE_MINUTE * 60 * 24;

const ensureIteration = async (unix: number) => {
  const date = new Date(unix);
  const iteration = await getDailyIteration(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
  );
  if (!iteration) await newIteration(date);
};

const ensureIterations = async (offsetDays: number) => {
  let day = Date.now() - offsetDays * ONE_DAY;
  while (day < Date.now() + ONE_DAY) {
    await ensureIteration(day);
    day += ONE_DAY;
  }
};

ensureIterations(14);
setInterval(() => ensureIterations(1), ONE_MINUTE);
