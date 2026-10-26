// Shared helpers for the i18n pipeline scripts. Build-only, never bundled. The
// catalog format:
//   en.json          — source: { key: { message, description } }
//   <locale>.json    — target: { key: { message, hash } }; hash is the SHA-256
//                      of the English message it was translated from, so
//                      editing the English marks every translation stale.
// i18n/config.json   — { "targets": ["de", "es", ...] }: the locales the
//                      pipeline maintains (en is the implicit source). Shared
//                      by every catalog below, as is i18n/glossary.json.

import { readFile, writeFile } from "node:fs/promises";
import { collectParams, parseMessage } from "./i18nParse.ts";

const I18N_DIR = new URL("../i18n/", import.meta.url);

// Every catalog the pipeline maintains: a directory under i18n/ holding the
// source `en.json` and one machine translation per target locale, compiled by
// genI18n to its own module. check / translate / unused treat them alike.
//   - the app's UI copy (client bundle and server push copy);
//   - the privacy page's, rendered by the server alone. Kept apart so its prose
//     doesn't ride in every client bundle, and so its English source's git
//     history is exactly the page's (linked from server/privacy/page.ts).
export type CatalogSpec = {
  // Directory under i18n/, with a trailing slash ("" for the app catalog).
  dir: string;
  // The generated module, relative to the repo root.
  out: string;
  // Extra translator guidance for this catalog, beyond the shared game-UI
  // prompt (see i18nTranslate.ts).
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

// `name` is relative to i18n/: `${spec.dir}<locale>.json`.
export const readJson = async <T>(name: string): Promise<T> =>
  JSON.parse(await readFile(new URL(name, I18N_DIR), "utf8"));

export const writeCatalog = async (
  dir: string,
  locale: string,
  catalog: TargetCatalog,
): Promise<void> => {
  // Sorted keys for stable diffs; trailing newline as the formatter would add.
  const sorted: TargetCatalog = Object.fromEntries(
    Object.entries(catalog).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
  );
  await writeFile(
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
// "other"; es → {one, many, other}, pl → {one, few, many, other}, ja →
// {other}). Exported so the translator prompt can name the branches.
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
 * Validate a translated message against its English source. Returns
 * human-readable errors ([] = valid): ICU must parse, the argument set must
 * match the source (the guard against an LLM dropping or inventing a
 * placeholder), and every plural must supply the locale's CLDR categories.
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
