export interface ByteRange {
  start: number;
  end: number;
}

export type ByteRangeResolution = { kind: 'full' } | { kind: 'partial'; range: ByteRange } | { kind: 'unsatisfiable' };

const SINGLE_RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/;

export function resolveByteRange(rangeHeader: string | undefined, size: number): ByteRangeResolution {
  if (rangeHeader === undefined || rangeHeader.trim() === '') return { kind: 'full' };
  const match = SINGLE_RANGE_PATTERN.exec(rangeHeader.trim());
  if (!match) return { kind: 'full' };

  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return { kind: 'full' };
  if (size <= 0) return { kind: 'unsatisfiable' };

  if (rawStart === '') {
    const suffixLength = Number(rawEnd);
    if (suffixLength === 0) return { kind: 'unsatisfiable' };
    return { kind: 'partial', range: { start: Math.max(size - suffixLength, 0), end: size - 1 } };
  }

  const start = Number(rawStart);
  if (start >= size) return { kind: 'unsatisfiable' };
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (end < start) return { kind: 'unsatisfiable' };
  return { kind: 'partial', range: { start, end } };
}

export function contentRangeHeader(range: ByteRange, size: number): string {
  return `bytes ${range.start}-${range.end}/${size}`;
}

export function unsatisfiableContentRangeHeader(size: number): string {
  return `bytes */${size}`;
}
