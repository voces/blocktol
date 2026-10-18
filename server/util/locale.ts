// Canonicalise a BCP-47 tag, or null if malformed. Every locale the server
// stores goes through this: `Intl` throws on a malformed tag when push copy is
// rendered, and one bad row would otherwise sink a whole notification batch.
export const canonicalLocale = (
  locale: string | undefined,
): string | null => {
  if (!locale) return null;
  try {
    return Intl.getCanonicalLocales(locale)[0] ?? null;
  } catch {
    return null;
  }
};
