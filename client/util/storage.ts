// A localStorage wrapper with an in-memory fallback. Browsers that block site
// data (cookie settings, some private modes, enterprise policy) throw a
// SecurityError on merely *accessing* `globalThis.localStorage`. Storage is
// read from module eval onward (identity in util/id.ts, sort signals, cached
// settings), so an unguarded access would crash the app at boot.
//
// When the real store is unusable we keep a per-tab Map, so the session still
// works but nothing survives a reload. `storagePersistent` says which mode we
// are in so the UI can warn the player (components/StorageNotice.tsx).

const memory = new Map<string, string>();

// Probe once at load: can we both read AND write? A store that throws on access
// or on write (Safari private mode) drops us to the memory map. The condition
// can't change without a reload.
const backing: Storage | null = (() => {
  try {
    const ls = globalThis.localStorage;
    const probe = "__blocktol_probe__";
    ls.setItem(probe, "1");
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
})();

// True when writes persist across reloads; false on the in-memory fallback.
// Fixed for the session.
export const storagePersistent = backing !== null;

export const storage = {
  getItem(key: string): string | null {
    if (backing) {
      try {
        return backing.getItem(key);
      } catch { /* fall through to the memory mirror */ }
    }
    return memory.get(key) ?? null;
  },
  setItem(key: string, value: string): void {
    // Mirror into memory even when persistent, so a store that fails
    // mid-session (quota) still reads back what we just wrote.
    memory.set(key, value);
    if (backing) {
      try {
        backing.setItem(key, value);
      } catch { /* quota/blocked — the memory copy stands in */ }
    }
  },
  removeItem(key: string): void {
    memory.delete(key);
    if (backing) {
      try {
        backing.removeItem(key);
      } catch { /* ignore */ }
    }
  },
};
