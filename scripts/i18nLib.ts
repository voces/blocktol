// Shared helpers for the i18n pipeline scripts (check / translate). Build-only,
// never bundled. The catalog format:
//   en.json          — source: { key: { message, description } }
//   <locale>.json    — target: { key: { message, hash } } where hash is the
//                      SHA-256 of the EXACT English message it was translated
//                      from. Editing an English string changes its hash, which
//                      invalidates (marks stale) every translation of it.
// i18n/config.json   — { "targets": ["de", "es", ...] } the locales the pipeline
//                      maintains (en is the implicit source; en-XA etc. are not
//                      real targets). Shared by every catalog below, as is
//                      i18n/glossary.json.

import { collectParams, parseMessage } from "./i18nParse.ts";

const I18N_DIR = new URL("../i18n/", import.meta.url);

// Every catalog the pipeline maintains. Each is a directory under i18n/ holding
// the source `en.json` and one machine translation per target locale, compiled
// by genI18n to its own module; check / translate / unused treat them alike.
//   - the app's UI copy, which the client bundles (and the server's push copy
//     reads);
//   - the privacy page's, rendered by the server alone. Kept apart so a page of
//     prose doesn't ride along in every client bundle (it would roughly double
//     the catalog), and so its English source is a file whose git history is
//     exactly the page's — the page links that history (server/privacy/page.ts).
export type CatalogSpec = {
  // Directory under i18n/, with a trailing slash ("" for the app catalog).
  dir: string;
  // The generated module, relative to the repo root.
  out: string;
  // Extra translator guidance for this catalog's register, beyond the shared
  // game-UI brief (see i18nTranslate.ts).
  brief?: string;
};

export const CATALOGS: CatalogSpec[] = [
  { dir: "", out: "common/i18n.generated.ts" },
  {
    dir: "privacy/",
    out: "server/privacy/catalog.generated.ts",
    brief:
      `These strings are the game's privacy notice, rendered as a web page — not
tight UI, so the length guidance doesn't apply. Translate each one completely
and faithfully in clear, plain language: don't shorten, summarise, soften, or
add anything (the English version is authoritative). Keep product and service
names (Blocktol, Discord, Google Fonts, Google, Mozilla, Apple, JSON, ELO) as-is.`,
  },
];

export type SourceEntry = { message: string; description?: string };
export type TargetEntry = { message: string; hash: string };
export type SourceCatalog = Record<string, SourceEntry>;
export type TargetCatalog = Record<string, TargetEntry>;

// `name` is relative to i18n/ — a catalog's files are `${spec.dir}<locale>.json`.
export const readJson = async <T>(name: string): Promise<T> =>
  JSON.parse(await Deno.readTextFile(new URL(name, I18N_DIR)));

export const writeCatalog = async (
  dir: string,
  locale: string,
  catalog: TargetCatalog,
): Promise<void> => {
  // Sorted keys → stable diffs; trailing newline like deno fmt would produce.
  const sorted: TargetCatalog = {};
  for (const k of Object.keys(catalog).sort()) sorted[k] = catalog[k];
  await Deno.writeTextFile(
    new URL(`${dir}${locale}.json`, I18N_DIR),
    JSON.stringify(sorted, null, 2) + "\n",
  );
};

export const loadConfig = async (): Promise<{ targets: string[] }> => {
  const cfg = await readJson<{ targets?: string[] }>("config.json");
  return { targets: cfg.targets ?? [] };
};

export const sha256 = async (s: string): Promise<string> => {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(s),
  );
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0"))
    .join("");
};

// The set of argument names an ICU message references (order-independent).
const argNames = (message: string): Set<string> =>
  new Set(Object.keys(collectParams(parseMessage(message))));

// The CLDR plural categories a locale requires for cardinals (always includes
// "other"; e.g. en → {one, other}, de → {one, other}, es → {one, many, other},
// pl → {one, few, many, other}, ja → {other}). Exported so the translator can
// tell the model exactly which branches to supply.
export const requiredPluralCategories = (locale: string): string[] => {
  try {
    return new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
  } catch {
    return ["other"];
  }
};

// Every plural node's branch selectors, collected from a parsed message.
const pluralSelectorSets = (message: string): string[][] => {
  const out: string[][] = [];
  const walk = (nodes: ReturnType<typeof parseMessage>) => {
    for (const n of nodes) {
      if (typeof n === "string" || "pound" in n) continue;
      if ("plural" in n) {
        out.push(Object.keys(n.plural));
        for (const b of Object.values(n.plural)) walk(b);
      } else if ("select" in n) {
        for (const b of Object.values(n.select)) walk(b);
      }
    }
  };
  walk(parseMessage(message));
  return out;
};

/**
 * Validate a translated message against its English source for a locale.
 * Returns a list of human-readable errors ([] = valid): ICU must parse, the
 * argument set must match the source exactly (the primary guard against an LLM
 * dropping or inventing a placeholder), and every plural must supply the CLDR
 * categories the locale requires.
 */
export const validateTranslation = (
  locale: string,
  key: string,
  message: string,
  englishMessage: string,
): string[] => {
  const errors: string[] = [];
  let args: Set<string>;
  try {
    args = argNames(message);
  } catch (e) {
    return [`${locale}/${key}: ICU parse error: ${(e as Error).message}`];
  }
  const want = argNames(englishMessage);
  const missing = [...want].filter((a) => !args.has(a));
  const extra = [...args].filter((a) => !want.has(a));
  if (missing.length) {
    errors.push(`${locale}/${key}: missing args ${missing.join(", ")}`);
  }
  if (extra.length) {
    errors.push(`${locale}/${key}: unexpected args ${extra.join(", ")}`);
  }

  const required = requiredPluralCategories(locale);
  for (const selectors of pluralSelectorSets(message)) {
    const cats = new Set(selectors.filter((s) => !s.startsWith("=")));
    const missingCats = required.filter((c) => !cats.has(c));
    if (missingCats.length) {
      errors.push(
        `${locale}/${key}: plural missing categor${
          missingCats.length > 1 ? "ies" : "y"
        } ${missingCats.join(", ")} (locale needs ${required.join(", ")})`,
      );
    }
  }
  return errors;
};
