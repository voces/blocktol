// `deno task i18n:translate` — the auto-fixer. Fills every missing/stale target
// entry and prunes orphans, so the i18n:check gate is cheap to satisfy: edit
// en.json, run this (or let the GitHub Action run it), commit. The provider sits
// behind the one-method `Translator` seam; the default adapter talks to the
// Anthropic Messages API directly (no external gateway). Swapping providers is a
// new adapter — the batching/planning/validation below is vendor-agnostic.

import {
  loadConfig,
  readJson,
  requiredPluralCategories,
  sha256,
  type SourceCatalog,
  type TargetCatalog,
  validateTranslation,
  writeCatalog,
} from "./i18nLib.ts";

export type Glossary = Record<string, string>;

export type TranslateRequest = {
  locale: string;
  entries: { key: string; message: string; description?: string }[];
  glossary: Glossary;
  // Validation errors from a previous attempt, fed back so the model self-corrects.
  notes?: string[];
};

// The seam. An implementation returns key → translated ICU message for every
// requested entry; everything above it (planning, validation, file IO) is here.
export interface Translator {
  translate(req: TranslateRequest): Promise<Record<string, string>>;
}

// Which of a target's keys need (re)translation (missing or source-changed).
export const staleKeys = async (
  en: SourceCatalog,
  existing: TargetCatalog,
): Promise<string[]> => {
  const out: string[] = [];
  for (const key of Object.keys(en)) {
    const cur = existing[key];
    if (!cur || cur.hash !== await sha256(en[key].message)) out.push(key);
  }
  return out;
};

// Call the translator for the stale entries, validate the result (retrying with
// the errors fed back on a dropped placeholder / bad plural), and build the fresh
// target catalog:
// unchanged translations kept, new ones spliced in, orphans dropped (we only
// iterate en's keys). Returns null when nothing changed.
export const translateLocale = async (
  translator: Translator,
  locale: string,
  en: SourceCatalog,
  existing: TargetCatalog,
  glossary: Glossary,
): Promise<TargetCatalog | null> => {
  const stale = await staleKeys(en, existing);
  const pruned = Object.keys(existing).some((k) => !(k in en));
  if (!stale.length && !pruned) return null;

  const next: TargetCatalog = {};
  for (const key of Object.keys(en)) {
    if (!stale.includes(key) && existing[key]) next[key] = existing[key];
  }

  if (stale.length) {
    const entries = stale.map((key) => ({
      key,
      message: en[key].message,
      description: en[key].description,
    }));
    let out: Record<string, string> | null = null;
    let notes: string[] | undefined;
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts && !out; attempt++) {
      const result = await translator.translate({
        locale,
        entries,
        glossary,
        notes,
      });
      const errors: string[] = [];
      for (const { key, message } of entries) {
        const got = result[key];
        if (got == null) {
          errors.push(`${locale}/${key}: no translation returned`);
        } else {
          errors.push(...validateTranslation(locale, key, got, message));
        }
      }
      if (!errors.length) out = result;
      else if (attempt === maxAttempts - 1) {
        throw new Error(
          `translation validation failed:\n  ${errors.join("\n  ")}`,
        );
      } else {
        notes = errors; // fed back so the next attempt corrects them
        console.warn(`retrying ${locale}:\n  ${errors.join("\n  ")}`);
      }
    }
    for (const key of stale) {
      next[key] = { message: out![key], hash: await sha256(en[key].message) };
    }
  }
  return next;
};

// ---- the default adapter: Anthropic Messages API, direct ----

const localeName = (locale: string): string => {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(locale) ??
      locale;
  } catch {
    return locale;
  }
};

// Stable across every batch and locale (only the glossary varies, rarely), so it
// caches: marked `cache_control: ephemeral`, each batch reads it at ~0.1×.
const systemPrompt = (glossary: Glossary): string =>
  `You are a professional game-UI translator. You translate short strings for
Blocktol, a daily competitive maze-building puzzle game.

Rules:
- Preserve ICU MessageFormat syntax EXACTLY. Placeholders like {players},
  {date}, and plural/select blocks ({count, plural, one {...} other {...}}) must
  appear with the SAME argument names. Never add, drop, or rename a placeholder.
  Translate the words around them, and the words inside plural/select branches.
- Keep the '#' inside a plural branch (it renders the count). Provide the plural
  categories the TARGET language needs (e.g. Polish needs one/few/many/other).
- '#1', '#{rank}' etc. are literal rank markers — keep the '#'.
- Match the source's tone and length; UI space is tight.
- Output ONLY a JSON object mapping each given key to its translated message.

Glossary (keep these terms consistent):
${Object.entries(glossary).map(([t, note]) => `- ${t}: ${note}`).join("\n")}`;

const userPrompt = (req: TranslateRequest): string => {
  const cats = requiredPluralCategories(req.locale);
  const lines = [
    `Translate these strings to ${localeName(req.locale)} (${req.locale}).`,
    // Deterministic plural guidance — the model otherwise misses categories that
    // are counterintuitive (e.g. Spanish/French/Portuguese cardinals need "many").
    `Any {…, plural, …} block MUST provide exactly these categories for ${req.locale}: ${
      cats.join(", ")
    } (plus any =N you keep from the source).`,
  ];
  if (req.notes?.length) {
    lines.push(
      `Your previous attempt had these problems — fix them:\n${
        req.notes.map((n) => `- ${n}`).join("\n")
      }`,
    );
  }
  return lines.join("\n\n") + "\n\n" +
    req.entries.map((e) =>
      `key: ${e.key}\nmessage: ${e.message}${
        e.description ? `\ncontext: ${e.description}` : ""
      }`
    ).join("\n\n");
};

export const makeAnthropicTranslator = (): Translator => ({
  async translate(req) {
    // Lazy: i18n:check / i18n:unused never load the SDK, and an empty target set
    // never reaches here (so the pipeline no-ops without a key).
    const { default: Anthropic } = await import("npm:@anthropic-ai/sdk");
    const client = new Anthropic();
    const model = Deno.env.get("TRANSLATE_MODEL") ?? "claude-opus-4-8";
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(
        req.entries.map((e) => [e.key, { type: "string" }]),
      ),
      required: req.entries.map((e) => e.key),
    };
    const res = await client.messages.create({
      model,
      max_tokens: 8000,
      system: [{
        type: "text",
        text: systemPrompt(req.glossary),
        cache_control: { type: "ephemeral" },
      }],
      output_config: { format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: userPrompt(req) }],
    });
    const text = res.content.find((b: { type: string }) => b.type === "text");
    return JSON.parse((text as { text: string })?.text ?? "{}");
  },
});

if (import.meta.main) {
  const { targets } = await loadConfig();
  const en = await readJson<SourceCatalog>("en.json");
  const glossary = await readJson<Glossary>("glossary.json").catch(() => ({}));
  const translator = makeAnthropicTranslator();
  let wrote = 0;
  for (const locale of targets) {
    const existing = await readJson<TargetCatalog>(`${locale}.json`).catch(
      () => ({}),
    );
    const next = await translateLocale(
      translator,
      locale,
      en,
      existing,
      glossary,
    );
    if (next) {
      await writeCatalog(locale, next);
      console.log(`i18n:translate wrote i18n/${locale}.json`);
      wrote++;
    } else console.log(`i18n:translate ${locale} up to date`);
  }
  console.log(`i18n:translate done — ${wrote} locale(s) updated`);
}
