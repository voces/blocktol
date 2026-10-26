// Each element with the one after it: (a, b), (b, c), ... for a path's
// segments or a sorted list's neighbours. Empty for fewer than two elements.
export function* pairs<T>(xs: Iterable<T>): Generator<[T, T]> {
  let prev: [T] | [] = [];
  for (const x of xs) {
    if (prev.length === 1) yield [prev[0], x];
    prev = [x];
  }
}
