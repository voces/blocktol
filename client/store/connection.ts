import { signal } from "@preact/signals";

// Consecutive transport failures (the server never responded). The blocking
// Disconnected overlay shows only once failures persist, so a single flaky
// request stays invisible while retries recover. Any success resets the count.
export const failures = signal(0);

export const noteFailure = () => {
  failures.value++;
};

export const noteSuccess = () => {
  if (failures.value) failures.value = 0;
};
