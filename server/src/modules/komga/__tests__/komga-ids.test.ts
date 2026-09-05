import { formatSeriesId, parseNumericId, parseSeriesId, seriesKeyEquals } from '../komga-ids';

describe('komga ids', () => {
  it('round trips every series id shape', () => {
    const keys = [
      { kind: 'series', libraryId: 3, seriesId: 42 },
      { kind: 'unknown', libraryId: 3 },
      { kind: 'oneshot', libraryId: 7, bookId: 1287 },
    ] as const;
    for (const key of keys) {
      const id = formatSeriesId(key);
      expect(parseSeriesId(id)).toEqual(key);
    }
    expect(formatSeriesId({ kind: 'series', libraryId: 3, seriesId: 42 })).toBe('3-s42');
    expect(formatSeriesId({ kind: 'unknown', libraryId: 3 })).toBe('3-u');
    expect(formatSeriesId({ kind: 'oneshot', libraryId: 7, bookId: 1287 })).toBe('7-b1287');
  });

  it('rejects malformed, zero and oversized ids', () => {
    for (const id of ['', '3', '3-', '3-x1', '0-s1', '3-s0', '3-b0', 'a-s1', '3-s1-b2', '3-s12345678901', ' 3-u']) {
      expect(parseSeriesId(id)).toBeNull();
    }
  });

  it('parses positive numeric ids only', () => {
    expect(parseNumericId('12')).toBe(12);
    for (const id of ['0', '-1', '1.5', 'abc', '', '12345678901']) {
      expect(parseNumericId(id)).toBeNull();
    }
  });

  it('compares keys structurally', () => {
    expect(seriesKeyEquals({ kind: 'unknown', libraryId: 1 }, { kind: 'unknown', libraryId: 1 })).toBe(true);
    expect(seriesKeyEquals({ kind: 'unknown', libraryId: 1 }, { kind: 'series', libraryId: 1, seriesId: 1 })).toBe(false);
  });
});
