import { BadRequestException, NotFoundException } from '@nestjs/common';

import type { RequestUser } from '../../../common/types/request-user';
import type { KomgaRequestAccount } from '../komga-auth.guard';
import { KomgaBookService, pickKomgaFile } from '../komga-book.service';
import type { KomgaBookHydration, KomgaBookRow } from '../komga-catalog.repository';
import type { KomgaBookFileRecord, KomgaScope } from '../komga-catalog.types';

const USER = {
  id: 1,
  isSuperuser: false,
  contentFilters: { includeTagIds: [], includeGenreIds: [], excludeTagIds: [], excludeGenreIds: [] },
} as unknown as RequestUser;
const ACCOUNT: KomgaRequestAccount = { id: 3, userId: 1, username: 'mihon', groupUnknownSeries: true, includeNonComicBooks: false };
const SCOPE: KomgaScope = {
  userId: 1,
  isSuperuser: false,
  contentFilters: USER.contentFilters,
  includeNonComicBooks: false,
  groupUnknownSeries: true,
  libraryIds: [2],
};

function file(overrides: Partial<KomgaBookFileRecord> = {}): KomgaBookFileRecord {
  return {
    id: 100,
    format: 'cbz',
    absolutePath: '/books/a.cbz',
    sizeBytes: 10,
    mtime: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    fileHash: null,
    pageCount: 3,
    pageMediaType: 'image/jpeg',
    ...overrides,
  };
}

function row(overrides: Partial<KomgaBookRow> = {}): KomgaBookRow {
  return {
    id: 10,
    libraryId: 2,
    primaryFileId: 100,
    folderPath: '/books/Folder Title',
    addedAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    formatPriority: ['epub', 'cbz', 'cbr'],
    title: 'Alpha',
    description: null,
    publishedDate: null,
    isbn10: null,
    isbn13: null,
    metadataUpdatedAt: null,
    ...overrides,
  };
}

function hydration(overrides: Partial<KomgaBookHydration> = {}): KomgaBookHydration {
  return {
    books: [],
    files: new Map(),
    authors: new Map(),
    tags: new Map(),
    credits: new Map(),
    memberships: new Map(),
    progress: new Map(),
    statuses: new Map(),
    ...overrides,
  };
}

function makeService(hydrated: KomgaBookHydration, numbering = new Map()) {
  const repository = {
    hydrateBooks: vi.fn().mockResolvedValue(hydrated),
    resolveSeriesNumbering: vi.fn().mockResolvedValue(numbering),
    findVisibleBookId: vi.fn().mockResolvedValue(10),
    listBooks: vi.fn().mockResolvedValue({ bookIds: [10], total: 1 }),
    listOnDeck: vi.fn().mockResolvedValue({ entries: [], total: 0 }),
  };
  const libraryService = { resolveScope: vi.fn().mockResolvedValue(SCOPE) };
  const comicPageService = {
    getManifest: vi.fn().mockResolvedValue({
      format: 'cbz',
      pageMediaType: 'image/*',
      pages: [
        { index: 0, entryName: 'p/001.png', mimeType: 'image/png', sizeBytes: 1 },
        { index: 1, entryName: 'p/002.jpg', mimeType: 'image/jpeg', sizeBytes: 2 },
      ],
    }),
    streamPage: vi.fn().mockResolvedValue({ stream: { kind: 'stream' }, mimeType: 'image/jpeg' }),
  };
  const bookService = { resolveDownloadFilename: vi.fn().mockResolvedValue('Alpha.cbz') };
  const service = new KomgaBookService(repository as never, libraryService as never, comicPageService as never, bookService as never);
  return { service, repository, comicPageService, libraryService, bookService };
}

describe('pickKomgaFile', () => {
  it('prefers the comic file that ranks highest in the library format priority', () => {
    const cbr = file({ id: 1, format: 'cbr' });
    const cbz = file({ id: 2, format: 'cbz' });
    const epub = file({ id: 3, format: 'epub' });
    expect(pickKomgaFile([cbr, cbz, epub], 3, ['epub', 'cbz', 'cbr'], true)).toBe(cbz);
    expect(pickKomgaFile([cbr, cbz], 1, ['epub'], true)).toBe(cbr);
    expect(pickKomgaFile([cbz, cbr], 2, [], false)).toBe(cbz);
  });

  it('falls back to the primary file only when the account includes non-comics', () => {
    const epub = file({ id: 3, format: 'epub' });
    const mp3 = file({ id: 4, format: 'mp3' });
    expect(pickKomgaFile([epub], 3, [], false)).toBeNull();
    expect(pickKomgaFile([epub], 3, [], true)).toBe(epub);
    expect(pickKomgaFile([epub], 9, [], true)).toBeNull();
    expect(pickKomgaFile([mp3], 4, [], true)).toBeNull();
  });
});

describe('KomgaBookService', () => {
  describe('buildRecords', () => {
    it('numbers indexed members from their index and un-indexed members after the highest index', async () => {
      const hydrated = hydration({
        books: [row({ id: 10 }), row({ id: 11, title: 'Loose' }), row({ id: 12, title: null })],
        files: new Map([
          [10, [file({ id: 100 })]],
          [11, [file({ id: 101 })]],
          [12, [file({ id: 102 })]],
        ]),
        memberships: new Map([
          [10, [{ bookId: 10, seriesId: 9, seriesName: 'Saga', seriesIndex: '2.5', displayOrder: 0 }]],
          [11, [{ bookId: 11, seriesId: 9, seriesName: 'Saga', seriesIndex: null, displayOrder: 0 }]],
        ]),
        authors: new Map([[10, ['Writer']]]),
        credits: new Map([[10, { bookId: 10, pencillers: ['Pencil'], inkers: null, colorists: [' '], letterers: [], coverArtists: ['Cover'] }]]),
        tags: new Map([[10, ['space']]]),
      });
      const numbering = new Map([
        ['2-s9', { indexedCount: 1, maxIndex: 2, ordinals: new Map([[11, 1]]) }],
        ['2-u', { indexedCount: 0, maxIndex: 0, ordinals: new Map([[12, 1]]) }],
      ]);
      const { service, repository } = makeService(hydrated, numbering);

      const records = await service.buildRecords(SCOPE, [10, 11, 12]);

      expect(records.map((record) => [record.id, record.title, record.series.number, record.series.numberSort, record.series.name])).toEqual([
        [10, 'Alpha', '2.5', 2.5, 'Saga'],
        [11, 'Loose', '3', 3, 'Saga'],
        [12, 'Folder Title', '1', 1, 'Unknown Series'],
      ]);
      expect(records[0].authors).toEqual([
        { name: 'Writer', role: 'writer' },
        { name: 'Pencil', role: 'penciller' },
        { name: 'Cover', role: 'cover' },
      ]);
      expect(records[0].tags).toEqual(['space']);
      expect(records[2].series.key).toEqual({ kind: 'unknown', libraryId: 2 });
      expect(repository.resolveSeriesNumbering).toHaveBeenCalledWith(SCOPE, [
        { kind: 'series', libraryId: 2, seriesId: 9 },
        { kind: 'unknown', libraryId: 2 },
      ]);
    });

    it('uses the requested series context and otherwise the primary membership', async () => {
      const memberships = [
        { bookId: 10, seriesId: 8, seriesName: 'Primary', seriesIndex: '1', displayOrder: 0 },
        { bookId: 10, seriesId: 9, seriesName: 'Crossover', seriesIndex: '4', displayOrder: 1 },
      ];
      const hydrated = hydration({ books: [row()], files: new Map([[10, [file()]]]), memberships: new Map([[10, memberships]]) });
      const { service } = makeService(hydrated);

      const [viaCrossover] = await service.buildRecords(SCOPE, [10], { kind: 'series', libraryId: 2, seriesId: 9 });
      expect(viaCrossover.series).toEqual({ key: { kind: 'series', libraryId: 2, seriesId: 9 }, name: 'Crossover', number: '4', numberSort: 4 });

      const [direct] = await service.buildRecords(SCOPE, [10]);
      expect(direct.series).toEqual({ key: { kind: 'series', libraryId: 2, seriesId: 8 }, name: 'Primary', number: '1', numberSort: 1 });
    });

    it('maps ungrouped books to one-shot series and omits books without a supported file', async () => {
      const hydrated = hydration({ books: [row({ id: 10 }), row({ id: 11 })], files: new Map([[10, [file()]]]) });
      const { service, repository } = makeService(hydrated);

      const records = await service.buildRecords({ ...SCOPE, groupUnknownSeries: false }, [10, 11]);
      expect(records).toHaveLength(1);
      expect(records[0].series).toEqual({ key: { kind: 'oneshot', libraryId: 2, bookId: 10 }, name: 'Alpha', number: '1', numberSort: 1 });
      expect(repository.resolveSeriesNumbering).toHaveBeenCalledWith(expect.anything(), []);
    });

    it('returns nothing for an empty id list without touching the database', async () => {
      const { service, repository } = makeService(hydration());
      await expect(service.buildRecords(SCOPE, [])).resolves.toEqual([]);
      expect(repository.hydrateBooks).not.toHaveBeenCalled();
    });

    it('attaches the progress of the chosen file and the status of the book for the scope user', async () => {
      const readAt = new Date('2026-03-01T00:00:00Z');
      const hydrated = hydration({
        books: [row({ id: 10 }), row({ id: 11 })],
        files: new Map([
          [10, [file({ id: 100 }), file({ id: 101, format: 'cbr' })]],
          [11, [file({ id: 102 })]],
        ]),
        progress: new Map([
          [101, { bookFileId: 101, pageNumber: 2, percentage: 66, lastReadAt: readAt, updatedAt: readAt }],
          [100, { bookFileId: 100, pageNumber: 1, percentage: 33, lastReadAt: readAt, updatedAt: readAt }],
        ]),
        statuses: new Map([[11, { bookId: 11, status: 'read' as const, source: 'auto' as const, finishedAt: readAt, updatedAt: readAt }]]),
      });
      const { service, repository } = makeService(hydrated);

      const [first, second] = await service.buildRecords(SCOPE, [10, 11]);

      expect(repository.hydrateBooks).toHaveBeenCalledWith([10, 11], SCOPE.userId);
      expect(first.file.id).toBe(100);
      expect(first.readState).toMatchObject({ status: null, pageNumber: 1, percentage: 33, lastReadAt: readAt });
      expect(second.readState).toMatchObject({ status: 'read', statusSource: 'auto', finishedAt: readAt, pageNumber: null, percentage: null });
    });
  });

  describe('pages', () => {
    const hydrated = () => hydration({ books: [row()], files: new Map([[10, [file()]]]) });

    it('lists manifest pages for comics and an empty list for other formats', async () => {
      const { service } = makeService(hydrated());
      await expect(service.listPages(USER, ACCOUNT, 10)).resolves.toHaveLength(2);

      const epub = makeService(hydration({ books: [row({ primaryFileId: 5 })], files: new Map([[10, [file({ id: 5, format: 'epub' })]]]) }));
      epub.libraryService.resolveScope.mockResolvedValue({ ...SCOPE, includeNonComicBooks: true });
      await expect(epub.service.listPages(USER, ACCOUNT, 10)).resolves.toEqual([]);
      await expect(epub.service.streamPage(USER, ACCOUNT, 10, 1, {})).rejects.toThrow(BadRequestException);
    });

    it('uses one-based page numbers, supports zero_based, and converts only when needed', async () => {
      const { service, comicPageService } = makeService(hydrated());
      const image = await service.streamPage(USER, ACCOUNT, 10, 2, { convert: 'jpeg' });
      expect(comicPageService.streamPage).toHaveBeenLastCalledWith(expect.objectContaining({ id: 100 }), 1, { convert: undefined });
      expect(image.etag).toBe(`"100-${new Date('2026-01-01T00:00:00Z').getTime()}-1-native"`);

      await service.streamPage(USER, ACCOUNT, 10, 0, { zero_based: true, convert: 'jpeg' });
      expect(comicPageService.streamPage).toHaveBeenLastCalledWith(expect.anything(), 0, { convert: 'jpeg' });

      await expect(service.streamPage(USER, ACCOUNT, 10, 0, {})).rejects.toThrow(BadRequestException);
      await expect(service.streamPage(USER, ACCOUNT, 10, 3, {})).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException for books outside the scope', async () => {
      const { service, repository } = makeService(hydrated());
      repository.findVisibleBookId.mockResolvedValue(null);
      await expect(service.get(USER, ACCOUNT, 10)).rejects.toThrow(NotFoundException);
      await expect(service.listPages(USER, ACCOUNT, 10)).rejects.toThrow(NotFoundException);
    });
  });

  describe('list and download', () => {
    it('short-circuits deleted listings and pages the rest', async () => {
      const { service, repository } = makeService(hydration({ books: [row()], files: new Map([[10, [file()]]]) }));
      const deleted = await service.list(USER, ACCOUNT, { deleted: true });
      expect(deleted.content).toEqual([]);
      expect(repository.listBooks).not.toHaveBeenCalled();

      const page = await service.list(USER, ACCOUNT, { search: 'alpha', page: 0, size: 10 });
      expect(page.totalElements).toBe(1);
      expect(page.content[0]).toMatchObject({ id: '10', name: 'Alpha' });
      expect(repository.listBooks).toHaveBeenCalledWith(SCOPE, expect.objectContaining({ search: 'alpha' }), expect.objectContaining({ size: 10 }));
    });

    it('lists the latest books by creation date regardless of the requested sort', async () => {
      const { service, repository } = makeService(hydration({ books: [row()], files: new Map([[10, [file()]]]) }));
      await service.listLatest(USER, ACCOUNT, { library_id: [2], size: 3 });
      expect(repository.listBooks).toHaveBeenCalledWith(
        SCOPE,
        expect.anything(),
        expect.objectContaining({ size: 3, sort: [{ property: 'createdDate', direction: 'desc' }] }),
      );
    });

    it('describes on deck books in the context of the series they continue', async () => {
      const memberships = [
        { bookId: 10, seriesId: 8, seriesName: 'Primary', seriesIndex: '1', displayOrder: 0 },
        { bookId: 10, seriesId: 9, seriesName: 'Crossover', seriesIndex: '4', displayOrder: 1 },
      ];
      const { service, repository } = makeService(
        hydration({ books: [row()], files: new Map([[10, [file()]]]), memberships: new Map([[10, memberships]]) }),
      );
      repository.listOnDeck.mockResolvedValue({ entries: [{ key: { kind: 'series', libraryId: 2, seriesId: 9 }, bookId: 10 }], total: 7 });

      const page = await service.listOnDeck(USER, ACCOUNT, { page: 1, size: 1 });

      expect(repository.listOnDeck).toHaveBeenCalledWith(SCOPE, expect.objectContaining({ page: 1, size: 1, offset: 1 }));
      expect(page.totalElements).toBe(7);
      expect(page.content[0]).toMatchObject({
        id: '10',
        seriesId: '2-s9',
        seriesTitle: 'Crossover',
        metadata: expect.objectContaining({ numberSort: 4 }),
      });
    });

    it('resolves the download file and its filename', async () => {
      const { service, bookService } = makeService(hydration({ books: [row()], files: new Map([[10, [file()]]]) }));
      await expect(service.resolveDownload(USER, ACCOUNT, 10)).resolves.toEqual({
        file: expect.objectContaining({ id: 100 }),
        filename: 'Alpha.cbz',
      });
      expect(bookService.resolveDownloadFilename).toHaveBeenCalledWith({ bookId: 10, absolutePath: '/books/a.cbz', format: 'cbz' });
    });
  });
});
