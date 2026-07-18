// A localStorage wrapper with an in-memory fallback. Some browsers block site
// data outright — a "block all cookies" / third-party-cookie content setting,
// certain private-browsing modes, an extension or enterprise policy — and in
// that state *accessing* `globalThis.localStorage` (not merely writing to it)
// throws a SecurityError. Blocktol reads storage from module eval onward — the
// per-device identity (util/id.ts), the standings/notification sort signals,
// cached settings — so an unguarded access crashes the whole app at boot for
// those visitors (the "Rejected" service-worker report is the same environment's
// first, more visible symptom).
//
// This wraps every access. When the real store is usable we delegate to it; when
// it isn't we keep a per-tab Map so the session still functions — identity is
// minted and held in memory, an in-progress build resumes within the tab, prefs
// apply — but nothing survives a reload. `storagePersistent` exposes which mode
// we landed in so the UI can tell the player their progress won't be saved (see
// components/StorageNotice.tsx).

const memory = new Map<string, string>();

// Probe once at load: can we both read AND write? A store that throws on access,
// or one that accepts nothing (Safari private mode historically threw on write),
// both fail here and drop us to the memory map. The condition can't change
// without a reload, so a single probe at module eval is enough.
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

// True when writes actually persist across reloads; false when we're on the
// in-memory fallback (site data blocked). A plain boolean — read once, never
// changes within a session.
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
    // Mirror into memory even on the persistent path, so a store that starts
    // working then fails mid-session (hits quota) still reads back what we just
    // wrote instead of a stale value.
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
