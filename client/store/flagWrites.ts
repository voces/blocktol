import type { Point } from "../../common/types.ts";

type Flags = readonly Point[];

// One iteration's writes in flight. `confirmed` is the last set the server is
// known to hold (what a failed write rolls back to) and `confirmedSeq` the
// write that set it, so an older write landing late can't overwrite a newer
// confirmation.
type Entry = {
  latest: number;
  inFlight: number;
  confirmed: Flags;
  confirmedSeq: number;
  rolledBack: boolean;
};

/**
 * The optimistic-write bookkeeping behind `saveFlags` (store/flags.ts), kept
 * free of the api so it can be tested. Every edit sends the whole set, so
 * writes overlap:
 *   - only the LATEST write's failure rolls back, to the last confirmed set,
 *     never to what the board showed when that write began (an older failure
 *     must not roll back over a newer edit);
 *   - `saving` holds while ANY write is in flight.
 * `send` resolves true when the server took the write.
 */
export const flagWrites = (
  current: (iteration: number) => Flags,
  put: (iteration: number, flags: Flags) => void,
  send: (iteration: number, flags: Flags) => Promise<boolean>,
) => {
  const entries = new Map<number, Entry>();
  let seq = 0;

  const saving = (iteration: number) => entries.has(iteration);

  const save = (iteration: number, flags: Flags): Promise<void> => {
    // Idle, the board shows what the server holds, so that is the baseline.
    const e = entries.get(iteration) ??
      {
        latest: 0,
        inFlight: 0,
        confirmed: current(iteration),
        confirmedSeq: 0,
        rolledBack: false,
      };
    entries.set(iteration, e);
    const s = e.latest = ++seq;
    e.inFlight++;
    e.rolledBack = false;
    put(iteration, flags);

    const settle = (ok: boolean) => {
      if (ok && s > e.confirmedSeq) {
        e.confirmed = flags;
        e.confirmedSeq = s;
        // The newest write already failed and rolled back; this older one
        // landing is now what the server holds.
        if (e.rolledBack) put(iteration, flags);
      } else if (!ok && s === e.latest) {
        e.rolledBack = true;
        put(iteration, e.confirmed);
      }
      if (--e.inFlight === 0) entries.delete(iteration);
    };
    return send(iteration, flags).then(settle, () => settle(false));
  };

  return { saving, save };
};
