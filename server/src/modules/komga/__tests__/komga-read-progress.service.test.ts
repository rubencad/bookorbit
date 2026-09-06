import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';

import type { RequestUser } from '../../../common/types/request-user';
import type { KomgaRequestAccount } from '../komga-auth.guard';
import type { KomgaBookReadState, KomgaBookRecord } from '../komga-catalog.types';
import { KomgaReadProgressService, summarizeSeriesProgress } from '../komga-read-progress.service';

const USER = { id: 1 } as RequestUser;
const ACCOUNT = { id: 3 } as KomgaRequestAccount;
const READ_AT = new Date('2026-03-01T00:00:00Z');
const SERIES_KEY = { kind: 'series' as const, libraryId: 2, seriesId: 9 };
// The mock walks series in batches of two so multi-batch behaviour is exercised with small fixtures.
const MOCK_BATCH_SIZE = 2;

function readState(overrides: Partial<KomgaBookReadState> = {}): KomgaBookReadState {
  return {
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
    ...overrides,
  };
}

const unread = readState();
const inProgress = readState({ pageNumber: 1, percentage: 50, lastReadAt: READ_AT, progressUpdatedAt: READ_AT });
const finished = readState({ status: 'read', statusSource: 'auto', pageNumber: 2, percentage: 100, lastReadAt: READ_AT, progressUpdatedAt: READ_AT });

function record(id: number, numberSort: number, state: KomgaBookReadState = unread, overrides: Partial<KomgaBookRecord> = {}): KomgaBookRecord {
  return {
    id,
    libraryId: 2,
    title: `Book ${id}`,
    addedAt: READ_AT,
    updatedAt: READ_AT,
    metadataUpdatedAt: null,
    description: null,
    publishedDate: null,
    isbn10: null,
    isbn13: null,
    file: {
      id: id * 10,
      format: 'cbz',
      absolutePath: `/books/${id}.cbz`,
      sizeBytes: 1,
      mtime: null,
      updatedAt: READ_AT,
      fileHash: null,
      pageCount: 2,
      pageMediaType: 'image/jpeg',
    },
    series: { key: SERIES_KEY, name: 'Saga', number: String(numberSort), numberSort },
    authors: [],
    tags: [],
    readState: state,
    ...overrides,
  };
}

function makeService(records: KomgaBookRecord[] = []) {
  const komgaBookService = {
    getRecord: vi.fn().mockImplementation((_user: RequestUser, _account: KomgaRequestAccount, bookId: number) => {
      const found = records.find((entry) => entry.id === bookId);
      return found ? Promise.resolve(found) : Promise.reject(new NotFoundException('Book not found'));
    }),
  };
  const batches: number[] = [];
  const seriesService = {
    forEachBookBatch: vi
      .fn()
      .mockImplementation(
        async (
          _user: RequestUser,
          _account: KomgaRequestAccount,
          seriesId: string,
          _batchSize: number,
          visit: (batch: KomgaBookRecord[], offset: number, total: number) => Promise<boolean | void> | boolean | void,
        ) => {
          if (seriesId === 'missing') throw new NotFoundException('Series not found');
          for (let offset = 0; offset < records.length; offset += MOCK_BATCH_SIZE) {
            batches.push(offset);
            const keepGoing = await visit(records.slice(offset, offset + MOCK_BATCH_SIZE), offset, records.length);
            if (keepGoing === false) break;
          }
          return { series: null, total: records.length };
        },
      ),
  };
  const bookService = {
    getProgress: vi.fn().mockResolvedValue(null),
    saveProgress: vi.fn().mockResolvedValue(undefined),
    clearBookProgress: vi.fn().mockResolvedValue(undefined),
    setReadStatus: vi.fn().mockResolvedValue(undefined),
  };
  const comicPageService = { getManifest: vi.fn().mockResolvedValue({ pages: [{}, {}, {}, {}] }) };
  const service = new KomgaReadProgressService(komgaBookService as never, seriesService as never, bookService as never, comicPageService as never);
  return { service, komgaBookService, seriesService, bookService, comicPageService, batches };
}

function savedProgress(bookService: ReturnType<typeof makeService>['bookService'], call = 0) {
  const args = bookService.saveProgress.mock.calls[call] as unknown[];
  return { fileId: args[1], dto: args[2] as { pageNumber: number | null; percentage: number; cfi: string | null }, origin: args[4] };
}

function savedFileIds(bookService: ReturnType<typeof makeService>['bookService']): number[] {
  return bookService.saveProgress.mock.calls.map((call) => call[1] as number);
}

describe('summarizeSeriesProgress', () => {
  it('counts states and follows the unbroken run of completed books', () => {
    const summary = summarizeSeriesProgress([record(1, 1, finished), record(2, 2, finished), record(3, 3), record(4, 4, inProgress)]);
    expect(summary).toEqual({
      booksCount: 4,
      booksReadCount: 2,
      booksUnreadCount: 1,
      booksInProgressCount: 1,
      lastReadContinuousIndex: 2,
      lastReadContinuousNumberSort: 2,
      maxNumberSort: 4,
    });
  });

  it('stops the run at an in-progress book even when later books are completed', () => {
    const summary = summarizeSeriesProgress([record(1, 1, finished), record(2, 2, inProgress), record(3, 3, finished)]);
    expect(summary).toMatchObject({ booksReadCount: 2, booksInProgressCount: 1, lastReadContinuousIndex: 1, lastReadContinuousNumberSort: 1 });
  });

  it('reports zero without progress and keeps duplicate numberSort values in the run', () => {
    expect(summarizeSeriesProgress([record(1, 1), record(2, 2)])).toMatchObject({ lastReadContinuousIndex: 0, lastReadContinuousNumberSort: 0 });
    expect(summarizeSeriesProgress([])).toMatchObject({ booksCount: 0, maxNumberSort: 0 });

    const duplicates = summarizeSeriesProgress([record(1, 1, finished), record(2, 1, finished), record(3, 2)]);
    expect(duplicates).toMatchObject({ lastReadContinuousIndex: 2, lastReadContinuousNumberSort: 1, maxNumberSort: 2 });
  });
});

describe('KomgaReadProgressService', () => {
  describe('updateBook', () => {
    it('stores a page within range as a percentage and attributes it to Komga', async () => {
      const { service, bookService } = makeService([record(1, 1)]);
      await service.updateBook(USER, ACCOUNT, 1, { page: 1 });

      const saved = savedProgress(bookService);
      expect(saved.fileId).toBe(10);
      expect(saved.dto).toMatchObject({ pageNumber: 1, percentage: 50 });
      expect(saved.origin).toBe('komga');
    });

    it('treats the last page and an explicit completed flag as fully read', async () => {
      const { service, bookService } = makeService([record(1, 1)]);
      await service.updateBook(USER, ACCOUNT, 1, { page: 2 });
      expect(savedProgress(bookService, 0).dto).toMatchObject({ pageNumber: 2, percentage: 100 });

      await service.updateBook(USER, ACCOUNT, 1, { completed: true, page: 1 });
      expect(savedProgress(bookService, 1).dto).toMatchObject({ pageNumber: 2, percentage: 100 });
    });

    it('keeps the stored location fields of the file when writing a Komga page', async () => {
      const { service, bookService } = makeService([record(1, 1)]);
      bookService.getProgress.mockResolvedValue({ cfi: 'epubcfi(/6/2)', koreaderProgress: '/body/p[3]', positionSeconds: null });
      await service.updateBook(USER, ACCOUNT, 1, { page: 1 });

      expect(savedProgress(bookService).dto).toMatchObject({ cfi: 'epubcfi(/6/2)', koreaderProgress: '/body/p[3]', pageNumber: 1 });
    });

    it('rejects pages outside 1..pagesCount and bodies without a page or completed flag', async () => {
      const { service, bookService } = makeService([record(1, 1)]);
      await expect(service.updateBook(USER, ACCOUNT, 1, { page: 0 })).rejects.toThrow(BadRequestException);
      await expect(service.updateBook(USER, ACCOUNT, 1, { page: 3 })).rejects.toThrow(BadRequestException);
      await expect(service.updateBook(USER, ACCOUNT, 1, {})).rejects.toThrow(BadRequestException);
      await expect(service.updateBook(USER, ACCOUNT, 1, { completed: false })).rejects.toThrow(BadRequestException);
      expect(bookService.saveProgress).not.toHaveBeenCalled();
    });

    it('accepts only completed for books without pages and never opens their archive', async () => {
      const epub = record(1, 1, unread, { file: { ...record(1, 1).file, format: 'epub', pageCount: null } });
      const { service, bookService, comicPageService } = makeService([epub]);

      await expect(service.updateBook(USER, ACCOUNT, 1, { page: 1 })).rejects.toThrow(BadRequestException);
      await service.updateBook(USER, ACCOUNT, 1, { completed: true });

      expect(savedProgress(bookService).dto).toMatchObject({ pageNumber: null, percentage: 100 });
      expect(comicPageService.getManifest).not.toHaveBeenCalled();
    });

    it('counts the pages of an uncounted comic before validating the page', async () => {
      const uncounted = record(1, 1, unread, { file: { ...record(1, 1).file, pageCount: null } });
      const { service, bookService, comicPageService } = makeService([uncounted]);

      await service.updateBook(USER, ACCOUNT, 1, { page: 3 });

      expect(comicPageService.getManifest).toHaveBeenCalledWith(expect.objectContaining({ id: 10, format: 'cbz' }));
      expect(savedProgress(bookService).dto).toMatchObject({ pageNumber: 3, percentage: 75 });
    });

    it('propagates 404 for books outside the account scope', async () => {
      const { service } = makeService([]);
      await expect(service.updateBook(USER, ACCOUNT, 99, { page: 1 })).rejects.toThrow(NotFoundException);
      await expect(service.clearBook(USER, ACCOUNT, 99)).rejects.toThrow(NotFoundException);
    });
  });

  describe('clearBook', () => {
    it('clears every file of the book and resets an automatic status to unread', async () => {
      const { service, bookService } = makeService([record(1, 1, finished)]);
      await service.clearBook(USER, ACCOUNT, 1);

      expect(bookService.clearBookProgress).toHaveBeenCalledWith(USER.id, 1, USER);
      expect(bookService.setReadStatus).toHaveBeenCalledWith(1, { status: 'unread' }, USER);
    });

    it('leaves manual statuses and books without a status alone', async () => {
      const manual = readState({ status: 'read', statusSource: 'manual', statusUpdatedAt: READ_AT });
      const { service, bookService } = makeService([record(1, 1, manual), record(2, 2, inProgress)]);

      await service.clearBook(USER, ACCOUNT, 1);
      await service.clearBook(USER, ACCOUNT, 2);

      expect(bookService.clearBookProgress).toHaveBeenCalledTimes(2);
      expect(bookService.setReadStatus).not.toHaveBeenCalled();
    });
  });

  describe('series operations', () => {
    it('marks every unfinished member read across batches and skips finished ones', async () => {
      const { service, bookService, batches } = makeService([
        record(1, 1, finished),
        record(2, 2, inProgress),
        record(3, 3),
        record(4, 4, finished),
        record(5, 5),
      ]);
      await service.markSeriesRead(USER, ACCOUNT, '2-s9');

      expect(batches).toEqual([0, 2, 4]);
      expect(savedFileIds(bookService)).toEqual([20, 30, 50]);
      expect(savedProgress(bookService, 0).dto).toMatchObject({ pageNumber: 2, percentage: 100 });
    });

    it('clears only members that carry progress', async () => {
      const { service, bookService } = makeService([record(1, 1, finished), record(2, 2, inProgress), record(3, 3)]);
      await service.clearSeries(USER, ACCOUNT, '2-s9');

      expect(bookService.clearBookProgress.mock.calls.map((call) => call[1])).toEqual([1, 2]);
      expect(bookService.setReadStatus).toHaveBeenCalledTimes(1);
      expect(bookService.setReadStatus).toHaveBeenCalledWith(1, { status: 'unread' }, USER);
    });

    it('answers the Tachiyomi tracker in both shapes from a batched walk of the series', async () => {
      const { service, seriesService, batches } = makeService([record(1, 1, finished), record(2, 2.5, inProgress), record(3, 3)]);

      await expect(service.tachiyomiProgressV2(USER, ACCOUNT, '2-s9')).resolves.toEqual({
        booksCount: 3,
        booksReadCount: 1,
        booksUnreadCount: 1,
        booksInProgressCount: 1,
        lastReadContinuousNumberSort: 1,
        maxNumberSort: 3,
      });
      await expect(service.tachiyomiProgressV1(USER, ACCOUNT, '2-s9')).resolves.toEqual({
        booksCount: 3,
        booksReadCount: 1,
        booksUnreadCount: 1,
        booksInProgressCount: 1,
        lastReadContinuousIndex: 1,
      });
      expect(seriesService.forEachBookBatch).toHaveBeenCalledWith(USER, ACCOUNT, '2-s9', 500, expect.any(Function));
      expect(batches).toEqual([0, 2, 0, 2]);
    });

    it('marks books up to the reported numberSort read, stops walking past it and never marks anything unread', async () => {
      const { service, bookService, batches } = makeService([
        record(1, 1, finished),
        record(2, 2),
        record(3, 3, inProgress),
        record(4, 4),
        record(5, 5),
        record(6, 6),
      ]);
      await service.markReadUpToNumberSort(USER, ACCOUNT, '2-s9', 3);

      expect(savedFileIds(bookService)).toEqual([20, 30]);
      expect(batches).toEqual([0, 2]);
      expect(bookService.clearBookProgress).not.toHaveBeenCalled();

      bookService.saveProgress.mockClear();
      await service.markReadUpToNumberSort(USER, ACCOUNT, '2-s9', 0.5);
      expect(bookService.saveProgress).not.toHaveBeenCalled();
    });

    it('marks the requested number of books as read across batch boundaries for the v1 tracker', async () => {
      const { service, bookService, batches } = makeService([record(1, 1, finished), record(2, 2), record(3, 3), record(4, 4), record(5, 5)]);
      await service.markReadUpToIndex(USER, ACCOUNT, '2-s9', 3);

      expect(savedFileIds(bookService)).toEqual([20, 30]);
      expect(batches).toEqual([0, 2]);
    });

    it('surfaces a member failure after the other writes settle and logs it once', async () => {
      const { service, bookService } = makeService([record(1, 1), record(2, 2)]);
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      bookService.saveProgress.mockRejectedValueOnce(new Error('disk full'));

      await expect(service.markSeriesRead(USER, ACCOUNT, '2-s9')).rejects.toThrow('disk full');
      expect(bookService.saveProgress).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('[komga.series_read_progress] [fail] seriesId=2-s9 userId=1 action=mark_read'));
      warn.mockRestore();
    });

    it('passes an unknown series through as 404 without logging a failure', async () => {
      const { service } = makeService([]);
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await expect(service.markSeriesRead(USER, ACCOUNT, 'missing')).rejects.toThrow(NotFoundException);
      await expect(service.tachiyomiProgressV2(USER, ACCOUNT, 'missing')).rejects.toThrow(NotFoundException);
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});
