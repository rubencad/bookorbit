import { NotFoundException } from '@nestjs/common';

import type { RequestUser } from '../../../common/types/request-user';
import type { KomgaRequestAccount } from '../komga-auth.guard';
import type { KomgaBookRecord, KomgaSeriesRecord } from '../komga-catalog.types';
import { KomgaSeriesService } from '../komga-series.service';

const USER = { id: 1 } as RequestUser;
const ACCOUNT = { id: 3 } as KomgaRequestAccount;
const SCOPE = { libraryIds: [2] };
const SERIES: KomgaSeriesRecord = {
  key: { kind: 'series', libraryId: 2, seriesId: 9 },
  name: 'Saga',
  booksCount: 2,
  booksReadCount: 0,
  booksInProgressCount: 0,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
  expectedBookCount: null,
};
const UNREAD = {
  status: null,
  statusSource: null,
  finishedAt: null,
  statusUpdatedAt: null,
  pageNumber: null,
  percentage: null,
  lastReadAt: null,
  progressUpdatedAt: null,
  resetAt: null,
  progressFileId: null,
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
};

function bookRecord(id: number): KomgaBookRecord {
  return {
    id,
    libraryId: 2,
    title: `Book ${id}`,
    addedAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    metadataUpdatedAt: null,
    description: null,
    publishedDate: null,
    isbn10: null,
    isbn13: null,
    file: {
      id,
      format: 'cbz',
      absolutePath: `/books/${id}.cbz`,
      sizeBytes: 1,
      mtime: null,
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      fileHash: null,
      pageCount: 1,
      pageMediaType: null,
    },
    series: { key: SERIES.key, name: SERIES.name, number: String(id), numberSort: id },
    authors: [],
    tags: [],
    readState: UNREAD,
  };
}

function makeService() {
  const repository = {
    listSeries: vi.fn().mockResolvedValue({ rows: [SERIES], total: 1 }),
    findSeries: vi.fn().mockResolvedValue(SERIES),
    aggregateSeries: vi.fn().mockResolvedValue(new Map([['2-s9', AGGREGATE]])),
    listSeriesBooks: vi.fn().mockResolvedValue({ bookIds: [10, 11], total: 2 }),
  };
  const libraryService = { resolveScope: vi.fn().mockResolvedValue(SCOPE) };
  const bookService = { buildRecords: vi.fn().mockResolvedValue([bookRecord(10), bookRecord(11)]) };
  return {
    service: new KomgaSeriesService(repository as never, libraryService as never, bookService as never),
    repository,
    libraryService,
    bookService,
  };
}

describe('KomgaSeriesService', () => {
  it('lists series with the parsed filters and hydrated aggregates', async () => {
    const { service, repository, libraryService } = makeService();
    const page = await service.list(USER, ACCOUNT, { library_id: [2], search: 'sa', status: ['ONGOING'], sort: ['createdDate,desc'] });
    expect(libraryService.resolveScope).toHaveBeenCalledWith(USER, ACCOUNT, [2]);
    expect(repository.listSeries).toHaveBeenCalledWith(
      SCOPE,
      expect.objectContaining({ search: 'sa', statuses: ['ONGOING'] }),
      expect.objectContaining({ sort: [{ property: 'createdDate', direction: 'desc' }] }),
    );
    expect(repository.aggregateSeries).toHaveBeenCalledWith(SCOPE, [SERIES.key]);
    expect(page.totalElements).toBe(1);
    expect(page.content[0]).toMatchObject({ id: '2-s9', name: 'Saga', booksCount: 2 });
  });

  it('walks series members in batches without an offset ceiling and stops when the visitor asks', async () => {
    const { service, repository, bookService } = makeService();
    repository.listSeriesBooks
      .mockResolvedValueOnce({ bookIds: [10, 11], total: 3 })
      .mockResolvedValueOnce({ bookIds: [12], total: 3 })
      .mockResolvedValueOnce({ bookIds: [10, 11], total: 3 });
    bookService.buildRecords.mockImplementation((_scope: unknown, ids: number[]) => Promise.resolve(ids.map(bookRecord)));
    const visit = vi.fn().mockResolvedValue(undefined);

    const { series, total } = await service.forEachBookBatch(USER, ACCOUNT, '2-s9', 2, visit);

    expect(series).toBe(SERIES);
    expect(total).toBe(3);
    expect(repository.listSeriesBooks).toHaveBeenNthCalledWith(1, SCOPE, SERIES.key, {}, expect.objectContaining({ page: 0, size: 2, offset: 0 }));
    expect(repository.listSeriesBooks).toHaveBeenNthCalledWith(2, SCOPE, SERIES.key, {}, expect.objectContaining({ page: 1, size: 2, offset: 2 }));
    expect(visit.mock.calls.map(([records, offset, count]) => [records.map((record: { id: number }) => record.id), offset, count])).toEqual([
      [[10, 11], 0, 3],
      [[12], 2, 3],
    ]);

    const stopping = vi.fn().mockResolvedValue(false);
    await service.forEachBookBatch(USER, ACCOUNT, '2-s9', 2, stopping);
    expect(stopping).toHaveBeenCalledTimes(1);
    expect(repository.listSeriesBooks).toHaveBeenCalledTimes(3);
  });

  it('orders the recency lists by creation or modification and limits updated to changed series', async () => {
    const { service, repository, libraryService } = makeService();

    await service.listRecent(USER, ACCOUNT, 'new', { library_id: [2], oneshot: false, size: 5 });
    expect(libraryService.resolveScope).toHaveBeenLastCalledWith(USER, ACCOUNT, [2]);
    expect(repository.listSeries).toHaveBeenLastCalledWith(
      SCOPE,
      expect.objectContaining({ oneshot: false, updatedOnly: false }),
      expect.objectContaining({ size: 5, sort: [{ property: 'createdDate', direction: 'desc' }] }),
    );

    await service.listRecent(USER, ACCOUNT, 'updated', {});
    expect(repository.listSeries).toHaveBeenLastCalledWith(
      SCOPE,
      expect.objectContaining({ updatedOnly: true }),
      expect.objectContaining({ sort: [{ property: 'lastModifiedDate', direction: 'desc' }] }),
    );

    await service.listRecent(USER, ACCOUNT, 'latest', {});
    expect(repository.listSeries).toHaveBeenLastCalledWith(
      SCOPE,
      expect.objectContaining({ updatedOnly: false }),
      expect.objectContaining({ unpaged: false, sort: [{ property: 'lastModifiedDate', direction: 'desc' }] }),
    );

    const unpaged = await service.listRecent(USER, ACCOUNT, 'latest', { unpaged: true });
    expect(repository.listSeries).toHaveBeenLastCalledWith(SCOPE, expect.anything(), expect.objectContaining({ unpaged: true, offset: 0 }));
    expect(unpaged.pageable.unpaged).toBe(true);
  });

  it('keeps the plain series list paged even when a client asks for unpaged', async () => {
    const { service, repository } = makeService();
    await service.list(USER, ACCOUNT, { unpaged: true });
    expect(repository.listSeries).toHaveBeenLastCalledWith(SCOPE, expect.anything(), expect.objectContaining({ unpaged: false, size: 500 }));
  });

  it('returns an empty page for deleted=true without querying', async () => {
    const { service, repository } = makeService();
    await expect(service.list(USER, ACCOUNT, { deleted: true })).resolves.toMatchObject({ content: [], totalElements: 0 });
    expect(repository.listSeries).not.toHaveBeenCalled();
  });

  it('rejects malformed and invisible series ids with 404', async () => {
    const { service, repository } = makeService();
    await expect(service.get(USER, ACCOUNT, 'nope')).rejects.toThrow(NotFoundException);
    repository.findSeries.mockResolvedValue(null);
    await expect(service.get(USER, ACCOUNT, '2-s9')).rejects.toThrow(NotFoundException);
    await expect(service.listBooks(USER, ACCOUNT, '2-s9', {})).rejects.toThrow(NotFoundException);
  });

  it('builds series books in the context of the browsed series', async () => {
    const { service, repository, bookService } = makeService();
    const page = await service.listBooks(USER, ACCOUNT, '2-s9', { unpaged: true, media_status: ['READY'] });
    expect(repository.listSeriesBooks).toHaveBeenCalledWith(
      SCOPE,
      SERIES.key,
      { mediaStatuses: ['READY'], tags: undefined },
      expect.objectContaining({ unpaged: true }),
    );
    expect(bookService.buildRecords).toHaveBeenCalledWith(SCOPE, [10, 11], SERIES.key);
    expect(page.pageable.unpaged).toBe(true);
    expect(page.totalElements).toBe(2);
    expect(page.content.map((book) => book.id)).toEqual(['10', '11']);
  });

  it('picks the lowest numbered book for the thumbnail and 404s when there is none', async () => {
    const { service, repository } = makeService();
    await expect(service.thumbnailBookId(USER, ACCOUNT, '2-s9')).resolves.toBe(10);
    repository.aggregateSeries.mockResolvedValue(new Map([['2-s9', { ...AGGREGATE, lowestBookId: null }]]));
    await expect(service.thumbnailBookId(USER, ACCOUNT, '2-s9')).rejects.toThrow(NotFoundException);
  });
});
