// Just enough of source map v3 to map a minified stack position back to source.

export type SourceMap = {
  sources: string[];
  names?: string[];
  mappings: string;
};

// [generated column, source index, source line, source column, name index?],
// all 0-based, one array per generated line.
type Segment = [number, number, number, number, number | undefined];

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// One segment's base64 VLQ fields.
const decodeVlq = (text: string): number[] => {
  const out: number[] = [];
  let value = 0;
  let shift = 0;
  for (const char of text) {
    const digit = B64.indexOf(char);
    if (digit < 0) throw new Error(`bad VLQ character ${char}`);
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
    } else {
      out.push(value & 1 ? -(value >>> 1) : value >>> 1);
      value = 0;
      shift = 0;
    }
  }
  return out;
};

// Fields are deltas: the generated column resets each line, the rest run on
// across the whole file.
export const decodeMappings = (mappings: string): Segment[][] => {
  const lines: Segment[][] = [];
  let src = 0, srcLine = 0, srcCol = 0, name = 0;
  for (const line of mappings.split(";")) {
    let col = 0;
    const segments: Segment[] = [];
    for (const part of line.split(",")) {
      if (!part) continue;
      const f = decodeVlq(part);
      col += f[0]!;
      if (f.length < 4) continue; // a generated span with no source
      src += f[1]!;
      srcLine += f[2]!;
      srcCol += f[3]!;
      if (f.length > 4) name += f[4]!;
      segments.push([
        col,
        src,
        srcLine,
        srcCol,
        f.length > 4 ? name : undefined,
      ]);
    }
    lines.push(segments);
  }
  return lines;
};

export type Original = {
  source: string;
  line: number;
  column: number;
  name: string | undefined;
};

// A stack frame's 1-based line:column in the generated file → the 1-based
// source position of the nearest mapping at or before it, or null.
export const originalPosition = (
  map: SourceMap,
  decoded: Segment[][],
  line: number,
  column: number,
): Original | null => {
  const segments = decoded[line - 1];
  if (!segments?.length) return null;
  let hit: Segment | undefined;
  for (const s of segments) {
    if (s[0] > column - 1) break;
    hit = s;
  }
  if (!hit) return null;
  const source = map.sources[hit[1]];
  if (source === undefined) return null; // an index past the map's sources
  return {
    source,
    line: hit[2] + 1,
    column: hit[3] + 1,
    name: hit[4] === undefined ? undefined : map.names?.[hit[4]],
  };
};
