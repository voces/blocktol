import { useEffect, useState } from "preact/compat";
import { Fragment, h, JSX } from "preact";
import { useRefState } from "../../hooks/useRefState.ts";
import { randomColor } from "./helpers.ts";

type Token = {
  kind: "text" | "inline" | "newline" | "localDate";
  content: string;
};

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

  let index = 0;
  const chain: NodeWithChildren[] = [root];
  while (index < tokens.length) {
    const token = tokens[index++];
    if (token.kind === "inline") {
      const inlineName = getInlineName(token.content);
      if (!inlineName) throw new Error(`Unknown inline kind: ${token.content}`);
      const chainIndex = chain.findIndex((n) => n.kind === inlineName);
      if (chainIndex >= 0) {
        chain.splice(chainIndex);
        continue;
      }

      const node: NodeWithChildren = { kind: inlineName, children: [] };
      chain[chain.length - 1].children.push(node);
      chain.push(node);
      continue;
    }

    if (token.kind === "newline") {
      chain[chain.length - 1].children.push({ kind: "newline" });
      continue;
    }

    if (token.kind === "text") {
      chain[chain.length - 1].children.push(token.content);
      continue;
    }

    if (token.kind === "localDate") {
      const parts = token.content.match(/\\localDate\((\d+), (\d+), (\d+)\)/);
      if (!parts || parts.length !== 4) {
        chain[chain.length - 1].children.push(token.content);
        continue;
      }
      chain[chain.length - 1].children.push(
        new Intl.DateTimeFormat(undefined, {
          dateStyle: "medium",
          timeZone: "UTC",
        }).format(
          new Date(
            parseInt(parts[1]),
            parseInt(parts[2]) - 1,
            parseInt(parts[3]),
          ),
        ),
      );
      continue;
    }

    throw new Error(`Unparseable token: ${JSON.stringify(token)}`);
  }

  return root;
};

export type Colors = Record<string, string | undefined>;

const ColorMarkdown = (
  { node, colors }: { node: NodeWithChildren; colors: Colors },
) => {
  const ref = useRefState<HTMLSpanElement | null>(null);
  const content = ref.current?.textContent;
  const color = content
    ? (colors[content] ?? (colors[content] = randomColor()))
    : undefined;

  return (
    <span ref={ref} style={{ color }}>
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

  useEffect(() => {
    try {
      setTree(parse(message));
    } catch (err) {
      console.error(err);
      setTree("");
    }
  }, [message]);

  return <InnerMarkdown node={tree} colors={colors} />;
};
