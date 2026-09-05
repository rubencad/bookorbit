export type KomgaSeriesKey =
  | { kind: 'series'; libraryId: number; seriesId: number }
  | { kind: 'unknown'; libraryId: number }
  | { kind: 'oneshot'; libraryId: number; bookId: number };

const SERIES_ID_PATTERN = /^(\d{1,9})-(?:s(\d{1,9})|u|b(\d{1,9}))$/;
const NUMERIC_ID_PATTERN = /^\d{1,9}$/;

export function formatSeriesId(key: KomgaSeriesKey): string {
  switch (key.kind) {
    case 'series':
      return `${key.libraryId}-s${key.seriesId}`;
    case 'unknown':
      return `${key.libraryId}-u`;
    case 'oneshot':
      return `${key.libraryId}-b${key.bookId}`;
  }
}

export function parseSeriesId(value: string): KomgaSeriesKey | null {
  const match = SERIES_ID_PATTERN.exec(value);
  if (!match) return null;
  const libraryId = Number(match[1]);
  if (libraryId <= 0) return null;
  if (match[2] !== undefined) {
    const seriesId = Number(match[2]);
    return seriesId > 0 ? { kind: 'series', libraryId, seriesId } : null;
  }
  if (match[3] !== undefined) {
    const bookId = Number(match[3]);
    return bookId > 0 ? { kind: 'oneshot', libraryId, bookId } : null;
  }
  return { kind: 'unknown', libraryId };
}

export function parseNumericId(value: string): number | null {
  if (!NUMERIC_ID_PATTERN.test(value)) return null;
  const parsed = Number(value);
  return parsed > 0 ? parsed : null;
}

export function seriesKeyEquals(a: KomgaSeriesKey, b: KomgaSeriesKey): boolean {
  return formatSeriesId(a) === formatSeriesId(b);
}
