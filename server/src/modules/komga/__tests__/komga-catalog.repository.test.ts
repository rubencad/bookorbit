import { KomgaCatalogRepository, isLaterProgress, type KomgaProgressRow } from '../komga-catalog.repository';
import type { KomgaScope } from '../komga-catalog.types';

const SCOPE: KomgaScope = {
  userId: 1,
  isSuperuser: true,
  contentFilters: { includeTagIds: [], includeGenreIds: [], excludeTagIds: [], excludeGenreIds: [] },
  includeNonComicBooks: false,
  groupUnknownSeries: true,
  libraryIds: [2],
};
const PAGE = { page: 0, size: 20, offset: 0, unpaged: false, sort: [{ property: 'metadata.titleSort', direction: 'asc' as const }] };

function makeChain() {
  const chain: Record<string, unknown> = {};
  for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy', 'limit', 'offset', 'groupBy'] as const) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  return chain;
}

function makeRepository(executeResults: Array<{ rows: unknown[] }> = []) {
  const queue = [...executeResults];
  const db = {
    execute: vi.fn().mockImplementation(() => Promise.resolve(queue.shift() ?? { rows: [] })),
    select: vi.fn().mockImplementation(() => makeChain()),
    selectDistinct: vi.fn().mockImplementation(() => makeChain()),
  };
  return { repository: new KomgaCatalogRepository(db as never), db };
}

describe('KomgaCatalogRepository', () => {
  it('skips database queries for an empty library scope', async () => {
    const { repository, db } = makeRepository();
    const empty = { ...SCOPE, libraryIds: [] };
    await expect(repository.listSeries(empty, {}, PAGE)).resolves.toEqual({ rows: [], total: 0 });
    await expect(repository.listBooks(empty, {}, PAGE)).resolves.toEqual({ bookIds: [], total: 0 });
    await expect(repository.listSeriesBooks(SCOPE, { kind: 'unknown', libraryId: 7 }, {}, PAGE)).resolves.toEqual({ bookIds: [], total: 0 });
    await expect(repository.findVisibleBookId(empty, 1)).resolves.toBeNull();
    await expect(repository.listReferentialValues(empty, 'genre', { limit: 10, offset: 0 })).resolves.toEqual({ values: [], total: 0 });
    await expect(repository.listReferentialAuthors(empty, { limit: 10, offset: 0 })).resolves.toEqual({ authors: [], total: 0 });
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('rejects inaccessible series keys and contradictory status filters', async () => {
    const { repository, db } = makeRepository();
    await expect(repository.findSeries(SCOPE, { kind: 'series', libraryId: 9, seriesId: 1 })).resolves.toBeNull();
    await expect(repository.listSeries(SCOPE, { statuses: ['ABANDONED'] }, PAGE)).resolves.toEqual({ rows: [], total: 0 });
    await expect(repository.findSeries(SCOPE, { kind: 'oneshot', libraryId: 2, bookId: 5 })).resolves.toBeNull();
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('maps grouped rows into series records for every id shape', async () => {
    const { repository } = makeRepository([
      {
        rows: [
          {
            library_id: 2,
            series_id: 9,
            book_id: null,
            name: 'Saga',
            books_count: 3,
            books_read_count: 1,
            books_in_progress_count: 1,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-02T00:00:00Z',
            expected_book_count: 3,
          },
          {
            library_id: 2,
            series_id: null,
            book_id: null,
            name: 'Unknown Series',
            books_count: 1,
            books_read_count: 0,
            books_in_progress_count: 0,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
            expected_book_count: null,
          },
          {
            library_id: 2,
            series_id: null,
            book_id: 77,
            name: 'Standalone',
            books_count: 1,
            books_read_count: 1,
            books_in_progress_count: 0,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
            expected_book_count: null,
          },
        ],
      },
      { rows: [{ total: '3' }] },
    ]);
    const { rows, total } = await repository.listSeries({ ...SCOPE, groupUnknownSeries: false }, {}, PAGE);
    expect(total).toBe(3);
    expect(rows.map((row) => row.key)).toEqual([
      { kind: 'series', libraryId: 2, seriesId: 9 },
      { kind: 'unknown', libraryId: 2 },
      { kind: 'oneshot', libraryId: 2, bookId: 77 },
    ]);
    expect(rows[0]).toMatchObject({
      name: 'Saga',
      booksCount: 3,
      booksReadCount: 1,
      booksInProgressCount: 1,
      expectedBookCount: 3,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    expect(rows[2]).toMatchObject({ booksReadCount: 1, booksInProgressCount: 0 });
  });

  it('pairs each on deck series with its first unread book and skips scopes without libraries', async () => {
    const seriesRow = {
      name: 'Saga',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      expected_book_count: null,
      last_read_at: null,
    };
    const { repository, db } = makeRepository([
      {
        rows: [
          { ...seriesRow, library_id: 2, series_id: 9, book_id: null, books_count: 3, books_read_count: 1, books_in_progress_count: 0 },
          { ...seriesRow, library_id: 2, series_id: null, book_id: null, books_count: 2, books_read_count: 1, books_in_progress_count: 0 },
        ],
      },
      { rows: [{ total: '2' }] },
      {
        rows: [
          { key: '2-u', book_id: 30 },
          { key: '2-s9', book_id: 11 },
        ],
      },
    ]);

    await expect(repository.listOnDeck(SCOPE, PAGE)).resolves.toEqual({
      entries: [
        { key: { kind: 'series', libraryId: 2, seriesId: 9 }, bookId: 11 },
        { key: { kind: 'unknown', libraryId: 2 }, bookId: 30 },
      ],
      total: 2,
    });
    expect(db.execute).toHaveBeenCalledTimes(3);

    const empty = makeRepository();
    await expect(empty.repository.listOnDeck({ ...SCOPE, libraryIds: [] }, PAGE)).resolves.toEqual({ entries: [], total: 0 });
    expect(empty.db.execute).not.toHaveBeenCalled();
  });

  it('reads the neighbours of a book from the ordered series window and skips one-shots', async () => {
    const { repository, db } = makeRepository([{ rows: [{ previous_id: 4, next_id: null }] }]);
    await expect(repository.findSeriesNeighbours(SCOPE, { kind: 'series', libraryId: 2, seriesId: 9 }, 5)).resolves.toEqual({
      previousId: 4,
      nextId: null,
    });
    expect(db.execute).toHaveBeenCalledTimes(1);

    const missing = makeRepository([{ rows: [] }]);
    await expect(missing.repository.findSeriesNeighbours(SCOPE, { kind: 'unknown', libraryId: 2 }, 5)).resolves.toEqual({
      previousId: null,
      nextId: null,
    });

    const skipped = makeRepository();
    await expect(skipped.repository.findSeriesNeighbours(SCOPE, { kind: 'oneshot', libraryId: 2, bookId: 5 }, 5)).resolves.toEqual({
      previousId: null,
      nextId: null,
    });
    await expect(skipped.repository.findSeriesNeighbours(SCOPE, { kind: 'series', libraryId: 7, seriesId: 9 }, 5)).resolves.toEqual({
      previousId: null,
      nextId: null,
    });
    expect(skipped.db.execute).not.toHaveBeenCalled();
  });

  it('returns no series when every requested read status is unknown', async () => {
    const { repository, db } = makeRepository();
    await expect(repository.listSeries(SCOPE, { readStatuses: ['SKIMMED'] }, PAGE)).resolves.toEqual({ rows: [], total: 0 });
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('maps aggregate query results and defaults missing values', async () => {
    const { repository, db } = makeRepository([
      { rows: [{ key: '2-s9', book_id: 10 }] },
      { rows: [{ key: '2-s9', description: 'Summary', series_index: '1' }] },
      { rows: [{ key: '2-s9', release_date: '2012-03-14', publisher: 'Image', language: 'en' }] },
      {
        rows: [
          { key: '2-s9', kind: 'genre', name: 'Drama' },
          { key: '2-s9', kind: 'tag', name: 'space' },
        ],
      },
      { rows: [{ key: '2-s9', name: 'Ann', role: 'writer' }] },
    ]);
    const aggregates = await repository.aggregateSeries(SCOPE, [
      { kind: 'series', libraryId: 2, seriesId: 9 },
      { kind: 'unknown', libraryId: 2 },
    ]);
    expect(db.execute).toHaveBeenCalledTimes(5);
    expect(aggregates.get('2-s9')).toEqual({
      lowestBookId: 10,
      summary: 'Summary',
      summaryNumber: '1',
      publisher: 'Image',
      language: 'en',
      releaseDate: '2012-03-14',
      genres: ['Drama'],
      tags: ['space'],
      authors: [{ name: 'Ann', role: 'writer' }],
    });
    expect(aggregates.get('2-u')).toEqual({
      lowestBookId: null,
      summary: '',
      summaryNumber: '',
      publisher: null,
      language: null,
      releaseDate: null,
      genres: [],
      tags: [],
      authors: [],
    });
  });

  it('uses the full database count for referential values', async () => {
    const { repository, db } = makeRepository([{ rows: [{ name: 'Drama' }, { name: 'Fantasy' }] }, { rows: [{ total: '2500' }] }]);
    await expect(repository.listReferentialValues(SCOPE, 'genre', { search: 'a', limit: 2, offset: 4 })).resolves.toEqual({
      values: ['Drama', 'Fantasy'],
      total: 2500,
    });
    expect(db.execute).toHaveBeenCalledTimes(2);

    const publishers = makeRepository([{ rows: [{ name: 'Image' }] }, { rows: [{ total: '1' }] }]);
    await expect(publishers.repository.listReferentialValues(SCOPE, 'publisher', { limit: 20, offset: 0 })).resolves.toEqual({
      values: ['Image'],
      total: 1,
    });
  });

  it('uses the full database count for author references', async () => {
    const { repository, db } = makeRepository([{ rows: [{ name: 'Ann', role: 'writer' }] }, { rows: [{ total: '40' }] }]);
    await expect(repository.listReferentialAuthors(SCOPE, { search: 'an', role: 'writer', limit: 1, offset: 0 })).resolves.toEqual({
      authors: [{ name: 'Ann', role: 'writer' }],
      total: 40,
    });
    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  it('reads numbering statistics and ordinals per series key', async () => {
    const { repository, db } = makeRepository([
      {
        rows: [
          { key: '2-s9', indexed_count: '2', max_index: '12' },
          { key: '2-u', indexed_count: '0', max_index: null },
        ],
      },
      {
        rows: [
          { key: '2-s9', book_id: 5, ordinal: '1' },
          { key: '2-u', book_id: 6, ordinal: '1' },
          { key: '2-u', book_id: 7, ordinal: '2' },
        ],
      },
    ]);
    const numbering = await repository.resolveSeriesNumbering(SCOPE, [
      { kind: 'series', libraryId: 2, seriesId: 9 },
      { kind: 'unknown', libraryId: 2 },
    ]);
    expect(numbering.get('2-s9')).toEqual({ indexedCount: 2, maxIndex: 12, ordinals: new Map([[5, 1]]) });
    expect(numbering.get('2-u')).toEqual({
      indexedCount: 0,
      maxIndex: 0,
      ordinals: new Map([
        [6, 1],
        [7, 2],
      ]),
    });
    expect(await repository.resolveSeriesNumbering(SCOPE, [])).toEqual(new Map());
    expect(db.execute).toHaveBeenCalledTimes(2);
  });
});

describe('isLaterProgress', () => {
  function progress(overrides: Partial<KomgaProgressRow>): KomgaProgressRow {
    return {
      bookId: 1,
      bookFileId: 10,
      pageNumber: null,
      percentage: 50,
      lastReadAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      ...overrides,
    };
  }

  it('prefers the most recent read, then the most recent write, then the highest file id', () => {
    const base = progress({});
    expect(isLaterProgress(progress({ lastReadAt: new Date('2026-01-02T00:00:00Z') }), base)).toBe(true);
    expect(isLaterProgress(progress({ lastReadAt: new Date('2025-12-31T00:00:00Z'), updatedAt: new Date('2026-02-01T00:00:00Z') }), base)).toBe(
      false,
    );
    expect(isLaterProgress(progress({ updatedAt: new Date('2026-01-01T00:00:01Z') }), base)).toBe(true);
    expect(isLaterProgress(progress({ bookFileId: 11 }), base)).toBe(true);
    expect(isLaterProgress(progress({ bookFileId: 9 }), base)).toBe(false);
    expect(isLaterProgress(progress({}), base)).toBe(false);
  });
});
