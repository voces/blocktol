import { adjectives } from "./adjectives.ts";
import { nouns } from "./nouns.ts";

const pick = (list: readonly string[]) =>
  list[Math.floor(Math.random() * list.length)];

// A random display name: an adjective run into a noun, lower case (e.g.
// `abruptfalcon`). Sliced to the `name` column's 32 chars.
export const randomName = () =>
  `${pick(adjectives)}${pick(nouns)}`.slice(0, 32);
