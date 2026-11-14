// Finds the original position of a generated one in a version 3 source map.

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

interface Segment {
  column: number;
  source: number;
  line: number;
  sourceColumn: number;
}

export interface OriginalPosition {
  source: string;
  // 1-based, like stack traces.
  line: number;
  column: number;
}

function decodeVlq(text: string): number[] {
  const values: number[] = [];
  let value = 0;
  let shift = 0;
  for (const char of text) {
    const digit = BASE64.indexOf(char);
    if (digit < 0) throw new Error(`Bad source map character ${char}`);
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
    } else {
      values.push(value & 1 ? -(value >>> 1) : value >>> 1);
      value = 0;
      shift = 0;
    }
  }
  return values;
}

export interface SourceMapLookup {
  // Takes and returns 1-based lines and columns.
  find(line: number, column: number): OriginalPosition | undefined;
}

export function parseSourceMap(json: string): SourceMapLookup {
  const map = JSON.parse(json) as { sources: string[]; mappings: string };
  const lines: Segment[][] = [];
  let source = 0;
  let line = 0;
  let sourceColumn = 0;
  for (const text of map.mappings.split(';')) {
    const segments: Segment[] = [];
    let column = 0;
    for (const part of text.split(',')) {
      if (!part) continue;
      const values = decodeVlq(part);
      column += values[0] ?? 0;
      if (values.length < 4) continue;
      source += values[1]!;
      line += values[2]!;
      sourceColumn += values[3]!;
      segments.push({ column, source, line, sourceColumn });
    }
    lines.push(segments);
  }
  return {
    find(generatedLine, generatedColumn) {
      const segments = lines[generatedLine - 1];
      if (!segments?.length) return undefined;
      let best = segments[0]!;
      for (const segment of segments) {
        if (segment.column > generatedColumn - 1) break;
        best = segment;
      }
      const name = map.sources[best.source];
      return name === undefined
        ? undefined
        : { source: name, line: best.line + 1, column: best.sourceColumn + 1 };
    },
  };
}
