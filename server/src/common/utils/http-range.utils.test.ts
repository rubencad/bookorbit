import { contentRangeHeader, resolveByteRange, unsatisfiableContentRangeHeader } from './http-range.utils';

describe('resolveByteRange', () => {
  it('serves the whole file without a usable Range header', () => {
    expect(resolveByteRange(undefined, 100)).toEqual({ kind: 'full' });
    expect(resolveByteRange('', 100)).toEqual({ kind: 'full' });
    expect(resolveByteRange('bytes=-', 100)).toEqual({ kind: 'full' });
    expect(resolveByteRange('bytes=0-9,20-29', 100)).toEqual({ kind: 'full' });
    expect(resolveByteRange('items=0-9', 100)).toEqual({ kind: 'full' });
  });

  it('resolves closed, open ended and suffix ranges within the file size', () => {
    expect(resolveByteRange('bytes=0-9', 100)).toEqual({ kind: 'partial', range: { start: 0, end: 9 } });
    expect(resolveByteRange('bytes=90-', 100)).toEqual({ kind: 'partial', range: { start: 90, end: 99 } });
    expect(resolveByteRange('bytes=50-500', 100)).toEqual({ kind: 'partial', range: { start: 50, end: 99 } });
    expect(resolveByteRange('bytes=-10', 100)).toEqual({ kind: 'partial', range: { start: 90, end: 99 } });
    expect(resolveByteRange('bytes=-500', 100)).toEqual({ kind: 'partial', range: { start: 0, end: 99 } });
  });

  it('flags ranges that start past the end, run backwards or address an empty file', () => {
    expect(resolveByteRange('bytes=100-', 100)).toEqual({ kind: 'unsatisfiable' });
    expect(resolveByteRange('bytes=20-10', 100)).toEqual({ kind: 'unsatisfiable' });
    expect(resolveByteRange('bytes=-0', 100)).toEqual({ kind: 'unsatisfiable' });
    expect(resolveByteRange('bytes=0-', 0)).toEqual({ kind: 'unsatisfiable' });
  });

  it('formats Content-Range headers', () => {
    expect(contentRangeHeader({ start: 0, end: 9 }, 100)).toBe('bytes 0-9/100');
    expect(unsatisfiableContentRangeHeader(100)).toBe('bytes */100');
  });
});
