import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { isComicContainerFormat } from '../../common/comic-format-detect';
import type { RequestUser } from '../../common/types/request-user';
import { mapWithConcurrency } from '../../common/utils/batch.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { BookService } from '../book/book.service';
import { ComicPageService } from '../comic-pages/comic-page.service';
import type { KomgaRequestAccount } from './komga-auth.guard';
import { KomgaBookService } from './komga-book.service';
import type { KomgaBookRecord } from './komga-catalog.types';
import type { ReadProgressUpdate } from './komga-query';
import { KomgaSeriesService } from './komga-series.service';
import { komgaPagesCount, komgaReadProgressFor } from './komga.mapper';

const SERIES_EVENT = 'komga.series_read_progress';
const SERIES_WRITE_CONCURRENCY = 5;

export interface KomgaSeriesProgressSummary {
  booksCount: number;
  booksReadCount: number;
  booksUnreadCount: number;
  booksInProgressCount: number;
  lastReadContinuousIndex: number;
  lastReadContinuousNumberSort: number;
  maxNumberSort: number;
}

export type KomgaTachiyomiProgressV1 = Omit<KomgaSeriesProgressSummary, 'lastReadContinuousNumberSort' | 'maxNumberSort'>;
export type KomgaTachiyomiProgressV2 = Omit<KomgaSeriesProgressSummary, 'lastReadContinuousIndex'>;

export function isKomgaCompleted(record: KomgaBookRecord): boolean {
  return komgaReadProgressFor(record)?.completed === true;
}

// Records must arrive in numberSort order: the continuous run stops at the first book that is not
// completed, so an in-progress book in the middle ends it.
export function summarizeSeriesProgress(records: readonly KomgaBookRecord[]): KomgaSeriesProgressSummary {
  let booksReadCount = 0;
  let booksInProgressCount = 0;
  let lastReadContinuousIndex = 0;
  let lastReadContinuousNumberSort = 0;
  let runUnbroken = true;
  let maxNumberSort = 0;

  for (const record of records) {
    const progress = komgaReadProgressFor(record);
    if (progress?.completed) booksReadCount += 1;
    else if (progress) booksInProgressCount += 1;
    if (runUnbroken && progress?.completed) {
      lastReadContinuousIndex += 1;
      lastReadContinuousNumberSort = record.series.numberSort;
    } else {
      runUnbroken = false;
    }
    maxNumberSort = Math.max(maxNumberSort, record.series.numberSort);
  }

  return {
    booksCount: records.length,
    booksReadCount,
    booksUnreadCount: records.length - booksReadCount - booksInProgressCount,
    booksInProgressCount,
    lastReadContinuousIndex,
    lastReadContinuousNumberSort,
    maxNumberSort,
  };
}

@Injectable()
export class KomgaReadProgressService {
  private readonly logger = new Logger(KomgaReadProgressService.name);

  constructor(
    private readonly komgaBookService: KomgaBookService,
    private readonly seriesService: KomgaSeriesService,
    private readonly bookService: BookService,
    private readonly comicPageService: ComicPageService,
  ) {}

  async updateBook(user: RequestUser, account: KomgaRequestAccount, bookId: number, update: ReadProgressUpdate): Promise<void> {
    const record = await this.komgaBookService.getRecord(user, account, bookId);
    await this.writeProgress(user, record, update);
  }

  async clearBook(user: RequestUser, account: KomgaRequestAccount, bookId: number): Promise<void> {
    const record = await this.komgaBookService.getRecord(user, account, bookId);
    await this.clearProgress(user, record);
  }

  async markSeriesRead(user: RequestUser, account: KomgaRequestAccount, seriesId: string): Promise<void> {
    const records = await this.seriesRecords(user, account, seriesId);
    await this.writeSeries(
      user,
      seriesId,
      'mark_read',
      records,
      (record) => !isKomgaCompleted(record),
      (record) => this.writeProgress(user, record, { completed: true }),
    );
  }

  async clearSeries(user: RequestUser, account: KomgaRequestAccount, seriesId: string): Promise<void> {
    const records = await this.seriesRecords(user, account, seriesId);
    await this.writeSeries(
      user,
      seriesId,
      'mark_unread',
      records,
      (record) => komgaReadProgressFor(record) !== null,
      (record) => this.clearProgress(user, record),
    );
  }

  async tachiyomiProgressV1(user: RequestUser, account: KomgaRequestAccount, seriesId: string): Promise<KomgaTachiyomiProgressV1> {
    const summary = summarizeSeriesProgress(await this.seriesRecords(user, account, seriesId));
    return {
      booksCount: summary.booksCount,
      booksReadCount: summary.booksReadCount,
      booksUnreadCount: summary.booksUnreadCount,
      booksInProgressCount: summary.booksInProgressCount,
      lastReadContinuousIndex: summary.lastReadContinuousIndex,
    };
  }

  async tachiyomiProgressV2(user: RequestUser, account: KomgaRequestAccount, seriesId: string): Promise<KomgaTachiyomiProgressV2> {
    const summary = summarizeSeriesProgress(await this.seriesRecords(user, account, seriesId));
    return {
      booksCount: summary.booksCount,
      booksReadCount: summary.booksReadCount,
      booksUnreadCount: summary.booksUnreadCount,
      booksInProgressCount: summary.booksInProgressCount,
      lastReadContinuousNumberSort: summary.lastReadContinuousNumberSort,
      maxNumberSort: summary.maxNumberSort,
    };
  }

  async markReadUpToIndex(user: RequestUser, account: KomgaRequestAccount, seriesId: string, lastBookRead: number): Promise<void> {
    const records = await this.seriesRecords(user, account, seriesId);
    await this.writeSeries(
      user,
      seriesId,
      'tachiyomi_v1',
      records,
      (record, index) => index < lastBookRead && !isKomgaCompleted(record),
      (record) => this.writeProgress(user, record, { completed: true }),
    );
  }

  async markReadUpToNumberSort(user: RequestUser, account: KomgaRequestAccount, seriesId: string, lastBookNumberSortRead: number): Promise<void> {
    const records = await this.seriesRecords(user, account, seriesId);
    await this.writeSeries(
      user,
      seriesId,
      'tachiyomi_v2',
      records,
      (record) => record.series.numberSort <= lastBookNumberSortRead && !isKomgaCompleted(record),
      (record) => this.writeProgress(user, record, { completed: true }),
    );
  }

  private async seriesRecords(user: RequestUser, account: KomgaRequestAccount, seriesId: string): Promise<KomgaBookRecord[]> {
    const { records } = await this.seriesService.listBookRecords(user, account, seriesId, { unpaged: true });
    return records;
  }

  private async writeSeries(
    user: RequestUser,
    seriesId: string,
    action: string,
    records: KomgaBookRecord[],
    shouldWrite: (record: KomgaBookRecord, index: number) => boolean,
    write: (record: KomgaBookRecord) => Promise<void>,
  ): Promise<void> {
    const startedAt = Date.now();
    const targets = records.filter(shouldWrite);
    this.logger.log(
      `[${SERIES_EVENT}] [start] seriesId=${seriesId} userId=${user.id} action=${action} books=${records.length} targets=${targets.length} - series read progress update started`,
    );
    try {
      await mapWithConcurrency(targets, SERIES_WRITE_CONCURRENCY, write);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(
        `[${SERIES_EVENT}] [fail] seriesId=${seriesId} userId=${user.id} action=${action} durationMs=${Date.now() - startedAt} errorClass=${err.constructor.name} error="${sanitizeLogValue(err.message)}" - series read progress update failed`,
      );
      throw error;
    }
    this.logger.log(
      `[${SERIES_EVENT}] [end] seriesId=${seriesId} userId=${user.id} action=${action} durationMs=${Date.now() - startedAt} updated=${targets.length} - series read progress update completed`,
    );
  }

  private async writeProgress(user: RequestUser, record: KomgaBookRecord, update: ReadProgressUpdate): Promise<void> {
    const pagesCount = await this.resolvePagesCount(record);
    let pageNumber: number | null;
    let percentage: number;
    if (update.completed === true) {
      pageNumber = pagesCount > 0 ? pagesCount : null;
      percentage = 100;
    } else if (typeof update.page === 'number') {
      if (pagesCount <= 0) throw new BadRequestException('Book has no pages to track');
      if (update.page < 1 || update.page > pagesCount) {
        throw new BadRequestException(`Page ${update.page} must be between 1 and ${pagesCount}`);
      }
      pageNumber = update.page;
      percentage = update.page === pagesCount ? 100 : (update.page / pagesCount) * 100;
    } else {
      throw new BadRequestException('Either page or completed is required');
    }

    const previous = await this.bookService.getProgress(user.id, record.file.id, user);
    await this.bookService.saveProgress(
      user.id,
      record.file.id,
      {
        cfi: previous?.cfi ?? null,
        pageNumber,
        percentage,
        positionSeconds: previous?.positionSeconds ?? null,
        koboLocationSource: previous?.koboLocationSource ?? null,
        koboLocationType: previous?.koboLocationType ?? null,
        koboLocationValue: previous?.koboLocationValue ?? null,
        koboContentSourceProgressPercent: previous?.koboContentSourceProgressPercent ?? null,
        koreaderProgress: previous?.koreaderProgress ?? null,
      },
      user,
      'komga',
    );
  }

  // Clearing the row alone leaves a read status in place, so the client would keep showing the book
  // as read. Statuses the user set by hand in BookOrbit are left alone.
  private async clearProgress(user: RequestUser, record: KomgaBookRecord): Promise<void> {
    await this.bookService.clearFileProgress(user.id, record.file.id, user);
    const { status, statusSource } = record.readState;
    if (status && status !== 'unread' && status !== 'want_to_read' && statusSource === 'auto') {
      await this.bookService.setReadStatus(record.id, { status: 'unread' }, user);
    }
  }

  private async resolvePagesCount(record: KomgaBookRecord): Promise<number> {
    const known = komgaPagesCount(record);
    if (known > 0 || !isComicContainerFormat(record.file.format)) return known;
    const { file } = record;
    const manifest = await this.comicPageService.getManifest({
      id: file.id,
      absolutePath: file.absolutePath,
      format: file.format,
      pageCount: file.pageCount,
      pageMediaType: file.pageMediaType,
    });
    return manifest.pages.length;
  }
}
