import { getDailyIteration } from "../db/iteration.ts";
import { newIteration } from "./newIteration.ts";

const ONE_DAY = 60 * 1_000 * 60 * 24;

let day = Date.now() - 100 * ONE_DAY;
while (day < Date.now()) {
  const date = new Date(day);
  const iteration = await getDailyIteration(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
  );
  if (!iteration) await newIteration(date);
  day += ONE_DAY;
}
