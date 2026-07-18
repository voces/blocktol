// The build-time ICU MessageFormat parser + param extractor. Lives in scripts/
// (never bundled) so the client ships only the compiled AST and the tiny walker
// in common/i18n.ts — no parser. genI18n.ts turns each i18n/<locale>.json message
// into an I18nNode[] with parseMessage, and derives the per-key params type map
// from en.json with collectParams.
//
// Supported ICU subset (all the app's copy needs): plain `{arg}` substitution,
// `{arg, plural, one {…} other {…} =0 {…}}` with `#`, and `{arg, select, …}`.
// Apostrophes are literal (no ICU quoting) — none of our messages need escaping.

import type { I18nNode } from "../common/i18n.ts";

const ident = /[A-Za-z0-9_.]/;

export const parseMessage = (src: string): I18nNode[] => {
  let i = 0;

  const skipWs = () => {
    while (i < src.length && /\s/.test(src[i])) i++;
  };
  const readIdent = (): string => {
    const start = i;
    while (i < src.length && ident.test(src[i])) i++;
    if (i === start) throw new Error(`expected identifier at ${i} in "${src}"`);
    return src.slice(start, i);
  };
  const readSelector = (): string => {
    if (src[i] === "=") {
      i++;
      return "=" + readIdent();
    }
    return readIdent();
  };

  // Parse a run of nodes up to the next unmatched `}` (a sub-message terminator)
  // or end of input (the top-level message). `inPlural` enables `#`.
  const parseNodes = (inPlural: boolean): I18nNode[] => {
    const nodes: I18nNode[] = [];
    let text = "";
    const flush = () => {
      if (text) {
        nodes.push(text);
        text = "";
      }
    };
    while (i < src.length) {
      const c = src[i];
      if (c === "}") break;
      if (c === "#" && inPlural) {
        flush();
        nodes.push({ pound: true });
        i++;
        continue;
      }
      if (c === "{") {
        flush();
        nodes.push(parsePlaceholder());
        continue;
      }
      text += c;
      i++;
    }
    flush();
    return nodes;
  };

  const parsePlaceholder = (): I18nNode => {
    i++; // "{"
    skipWs();
    const arg = readIdent();
    skipWs();
    if (src[i] === "}") {
      i++;
      return { arg };
    }
    if (src[i] !== ",") {
      throw new Error(`expected ',' or '}' after arg '${arg}' in "${src}"`);
    }
    i++;
    skipWs();
    const type = readIdent();
    if (type !== "plural" && type !== "select") {
      throw new Error(`unsupported placeholder type '${type}' in "${src}"`);
    }
    skipWs();
    if (src[i] !== ",") {
      throw new Error(`expected ',' after '${type}' in "${src}"`);
    }
    i++;
    skipWs();
    const branches: Record<string, I18nNode[]> = {};
    while (i < src.length && src[i] !== "}") {
      const sel = readSelector();
      skipWs();
      if (src[i] !== "{") {
        throw new Error(`expected '{' after '${sel}' in "${src}"`);
      }
      i++; // sub-message "{"
      branches[sel] = parseNodes(type === "plural");
      if (src[i] !== "}") {
        throw new Error(`unterminated branch '${sel}' in "${src}"`);
      }
      i++; // sub-message "}"
      skipWs();
    }
    if (src[i] !== "}") throw new Error(`unterminated placeholder in "${src}"`);
    i++; // placeholder "}"
    if (type === "plural") {
      if (!("other" in branches)) {
        throw new Error(`plural '${arg}' missing 'other' branch in "${src}"`);
      }
      return { arg, plural: branches };
    }
    if (!("other" in branches)) {
      throw new Error(`select '${arg}' missing 'other' branch in "${src}"`);
    }
    return { arg, select: branches };
  };

  const nodes = parseNodes(false);
  if (i !== src.length) throw new Error(`unexpected '}' at ${i} in "${src}"`);
  return nodes;
};

// An argument's TypeScript type: a plural count is `number`, a select key is
// `string`, a bare `{arg}` could be either. `number` > `string` > `either`
// wins when an arg appears in more than one role.
export type ParamKind = "number" | "string" | "either";

const tsType: Record<ParamKind, string> = {
  number: "number",
  string: "string",
  either: "string | number",
};

const merge = (a: ParamKind, b: ParamKind): ParamKind => {
  if (a === "number" || b === "number") return "number";
  if (a === "string" || b === "string") return "string";
  return "either";
};

// Collect the params (name → TS type string) a message references.
export const collectParams = (
  nodes: readonly I18nNode[],
): Record<string, string> => {
  const kinds = new Map<string, ParamKind>();
  const note = (arg: string, kind: ParamKind) => {
    kinds.set(arg, kinds.has(arg) ? merge(kinds.get(arg)!, kind) : kind);
  };
  const walk = (ns: readonly I18nNode[]) => {
    for (const n of ns) {
      if (typeof n === "string" || "pound" in n) continue;
      if ("plural" in n) {
        note(n.arg, "number");
        for (const b of Object.values(n.plural)) walk(b);
      } else if ("select" in n) {
        note(n.arg, "string");
        for (const b of Object.values(n.select)) walk(b);
      } else {
        note(n.arg, "either");
      }
    }
  };
  walk(nodes);
  const out: Record<string, string> = {};
  for (const [arg, kind] of kinds) out[arg] = tsType[kind];
  return out;
};
