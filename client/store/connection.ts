import { signal } from "@preact/signals";

// Consecutive transport failures (fetch-level — the server never responded).
// The Disconnected overlay is blocking, so it only shows once failures
// persist: a single flaky request stays invisible while the run saver / boot
// retry quietly recover. Any successful response resets the count.
export const failures = signal(0);

export const noteFailure = () => {
  failures.value++;
};

export const noteSuccess = () => {
  if (failures.value) failures.value = 0;
};
