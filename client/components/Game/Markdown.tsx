import { useEffect, useState } from "preact/compat";
import { Fragment, h, type JSX } from "preact";
import { randomColor } from "./helpers.ts";
import { intlLocale } from "../../util/t.ts";

type Token = {
  kind: "text" | "inline" | "newline" | "localDate";
  content: string;
};

// Message syntax: `\c` toggles a colour span, `\\c` is a literal `\c`, and
// `\localDate(y, m, d)` formats a calendar date in the UI locale.
const tokenize = (string: string) => {
  const tokens: Token[] = [];
  let index = 0;
  const test = (kind: Token["kind"], regexp: RegExp): boolean => {
    regexp.lastIndex = index;
    const results = regexp.exec(string);
    const result = results?.[0];
    if (result) {
      tokens.push({ kind, content: result });
      index += result.length;
      return true;
    }
    return false;
  };
  while (index < string.length) {
    if (test("inline", /(?<!\\)(?:\\c)/y)) continue;
    if (test("localDate", /\\localDate\(\d+, \d+, \d+\)/y)) continue;
    if (test("newline", /\n/y)) continue;
    if (
      test("text", /(?:\\\\c|(?!\\c|\n|\\localDate\(\d+, \d+, \d+\))[\s\S])+/y)
    ) continue;

    throw new Error(`Untokenizable at ${string.slice(index, index + 20)}`);
  }
  return tokens;
};

const INLINE_NAME_MAP = {
  "\\c": "color",
} as const;
const getInlineName = (content: string) => {
  if (content in INLINE_NAME_MAP) {
    return INLINE_NAME_MAP[content as keyof typeof INLINE_NAME_MAP];
  }
  throw new Error(`Unknown inline kind: ${content}`);
};

type RootNode = { kind: "root"; children: (Node | string)[] };

type NodeWithChildren =
  | RootNode
  | { kind: "color"; children: (Node | string)[] };

type Node =
  | NodeWithChildren
  | { kind: "newline" };

const parse = (string: string) => {
  const tokens = tokenize(string);
  const root: RootNode = { kind: "root", children: [] };

  // The open nodes, innermost last; the root is never closed.
  const chain: NodeWithChildren[] = [root];
  const top = () => chain.at(-1) ?? root;
  for (const token of tokens) {
    if (token.kind === "inline") {
      const inlineName = getInlineName(token.content);
      const chainIndex = chain.findIndex((n) => n.kind === inlineName);
      if (chainIndex >= 0) {
        chain.splice(chainIndex);
        continue;
      }

      const node: NodeWithChildren = { kind: inlineName, children: [] };
      top().children.push(node);
      chain.push(node);
      continue;
    }

    if (token.kind === "newline") {
      top().children.push({ kind: "newline" });
      continue;
    }

    if (token.kind === "text") {
      top().children.push(token.content);
      continue;
    }

    // The last kind: "localDate".
    const [, year, month, day] =
      token.content.match(/\\localDate\((\d+), (\d+), (\d+)\)/) ?? [];
    if (year === undefined || month === undefined || day === undefined) {
      top().children.push(token.content);
      continue;
    }
    top().children.push(
      new Intl.DateTimeFormat(intlLocale(), {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(
        // UTC midnight to match the UTC formatting; local midnight read in
        // UTC is the previous day east of Greenwich.
        new Date(Date.UTC(
          parseInt(year),
          parseInt(month) - 1,
          parseInt(day),
        )),
      ),
    );
  }

  return root;
};

export type Colors = Record<string, string | undefined>;

const ColorMarkdown = (
  { node, colors }: { node: NodeWithChildren; colors: Colors },
) => {
  // A state-backed ref: mounting triggers a second render that reads the
  // text and picks its colour. Equal text shares a colour via `colors`.
  const [el, setEl] = useState<HTMLSpanElement | null>(null);
  const content = el?.textContent;
  const color = content
    ? (colors[content] ?? (colors[content] = randomColor()))
    : undefined;

  return (
    <span ref={setEl} style={{ color }}>
      {node.children.map((node) => (
        <InnerMarkdown
          node={node}
          colors={colors}
        />
      ))}
    </span>
  );
};

const InnerMarkdown = (
  { node, colors }: { node: Node | string; colors: Colors },
): JSX.Element => {
  if (typeof node === "string") return <>{node}</>;
  if (node.kind === "newline") return <br />;
  if (node.kind === "color") {
    return <ColorMarkdown node={node} colors={colors} />;
  }

  return (
    <>
      {node.children.map((node) => (
        <InnerMarkdown
          node={node}
          colors={colors}
        />
      ))}
    </>
  );
};

export const Markdown = (
  { message, colors }: {
    message: string;
    colors: Colors;
  },
) => {
  const [tree, setTree] = useState(() => {
    try {
      return parse(message);
    } catch (err) {
      console.error(err);
      return "";
    }
  });

  // Dates in the tree are formatted at parse time, so a language switch
  // re-parses.
  const locale = intlLocale();
  useEffect(() => {
    try {
      setTree(parse(message));
    } catch (err) {
      console.error(err);
      setTree("");
    }
  }, [message, locale]);

  return <InnerMarkdown node={tree} colors={colors} />;
};
