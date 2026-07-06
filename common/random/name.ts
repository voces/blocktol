import { adjectives } from "./adjectives.ts";
import { names } from "./names.ts";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// A seeded display name: a capitalised adjective + a first name (the name list
// is weighted toward the front via the squared random, matching the old login
// screen). Sliced to the `name` column's 32 chars.
export const randomName = () =>
  `${cap(adjectives[Math.floor(Math.random() * adjectives.length)])} ${
    names[Math.floor(Math.random() ** 2 * names.length)]
  }`.slice(0, 32);
