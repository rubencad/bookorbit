import type { RequestUser } from '../../../common/types/request-user';
import type { KomgaRequestAccount } from '../komga-auth.guard';
import type { KomgaBookRecord, KomgaSeriesAggregate, KomgaSeriesRecord } from '../komga-catalog.types';
import { KomgaOpdsService } from '../komga-opds.service';

const USER = { id: 1 } as RequestUser;
const ACCOUNT = { id: 3 } as KomgaRequestAccount;
const NOW = new Date('2026-01-02T00:00:00Z');
const PAGE = { page: 0, size: 20, offset: 0, unpaged: false, sort: [] };

const SERIES: KomgaSeriesRecord = {
  key: { kind: 'series', libraryId: 2, seriesId: 9 },
  name: 'Saga',
  booksCount: 2,
  createdAt: NOW,
  updatedAt: NOW,
  expectedBookCount: null,
};

const AGGREGATE = {
  lowestBookId: 10,
  summary: '',
  summaryNumber: '',
  publisher: null,
  language: null,
  releaseDate: null,
  genres: [],
  tags: [],
  authors: [],
} satisfies KomgaSeriesAggregate;

const BOOK: KomgaBookRecord = {
  id: 10,
  libraryId: 2,
  title: 'Book 10',
  addedAt: NOW,
  updatedAt: NOW,
  metadataUpdatedAt: null,
  description: null,
  publishedDate: null,
  isbn10: null,
  isbn13: null,
  file: {
    id: 10,
    format: 'cbz',
    absolutePath: '/books/book10.cbz',
    sizeBytes: 100,
    mtime: NOW,
    updatedAt: NOW,
    fileHash: null,
    pageCount: 12,
    pageMediaType: 'image/jpeg',
  },
  series: { key: SERIES.key, name: 'Saga', number: '1', numberSort: 1 },
  authors: [],
  tags: [],
};

function createService() {
  const libraryService = {
    listLibraries: vi.fn().mockResolvedValue([{ id: 2, name: 'Comics', createdAt: NOW, updatedAt: NOW }]),
    getLibrary: vi.fn().mockResolvedValue({ id: 2, name: 'Comics', createdAt: NOW, updatedAt: NOW }),
  };
  const seriesService = {
    listRecords: vi.fn().mockResolvedValue({ records: [SERIES], aggregates: new Map([['2-s9', AGGREGATE]]), page: PAGE, total: 1 }),
    listBookRecords: vi.fn().mockResolvedValue({ records: [BOOK], series: SERIES, page: PAGE, total: 1 }),
  };
  const bookService = {
    listRecords: vi.fn().mockResolvedValue({ records: [BOOK], page: PAGE, total: 1 }),
  };
  const service = new KomgaOpdsService(libraryService as never, seriesService as never, bookService as never);
  return { service, libraryService, seriesService, bookService };
}

describe('KomgaOpdsService', () => {
  it('offers the browsable subsections from the catalog', () => {
    const xml = createService().service.catalog();

    expect(xml).toContain('href="/komga/opds/v1.2/series"');
    expect(xml).toContain('href="/komga/opds/v1.2/series/latest"');
    expect(xml).toContain('href="/komga/opds/v1.2/books/latest"');
    expect(xml).toContain('href="/komga/opds/v1.2/libraries"');
    expect(xml).toContain('rel="search"');
  });

  it('passes the search term through to the series query', async () => {
    const { service, seriesService } = createService();
    const xml = await service.series(USER, ACCOUNT, { search: 'saga' });

    expect(seriesService.listRecords).toHaveBeenCalledWith(USER, ACCOUNT, expect.objectContaining({ search: 'saga' }));
    expect(xml).toContain('<title>Search: saga</title>');
    expect(xml).toContain('href="/komga/opds/v1.2/series?search=saga&amp;page=0"');
  });

  it('scopes a library feed to that library only', async () => {
    const { service, seriesService } = createService();
    const xml = await service.librarySeries(USER, ACCOUNT, 2, {});

    expect(seriesService.listRecords).toHaveBeenCalledWith(USER, ACCOUNT, expect.objectContaining({ library_id: [2] }));
    expect(xml).toContain('<title>Comics</title>');
  });

  it('sorts the latest feeds by recency', async () => {
    const { service, seriesService, bookService } = createService();
    await service.latestSeries(USER, ACCOUNT, {});
    await service.latestBooks(USER, ACCOUNT, {});

    expect(seriesService.listRecords).toHaveBeenCalledWith(USER, ACCOUNT, expect.objectContaining({ sort: ['lastModifiedDate,desc'] }));
    expect(bookService.listRecords).toHaveBeenCalledWith(USER, ACCOUNT, expect.objectContaining({ sort: ['createdDate,desc'] }));
  });

  it('titles a series feed after the series and lists its books', async () => {
    const { service } = createService();
    const xml = await service.seriesBooks(USER, ACCOUNT, '2-s9', {});

    expect(xml).toContain('<title>Saga</title>');
    expect(xml).toContain('<id>10</id>');
    expect(xml).toContain('opds-pse/stream');
  });

  it('prefixes series titles in the latest books feed', async () => {
    const { service } = createService();

    expect(await service.latestBooks(USER, ACCOUNT, {})).toContain('<title>Saga 1: Book 10</title>');
  });
});
