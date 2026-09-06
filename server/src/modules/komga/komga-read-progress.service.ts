import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { isComicContainerFormat } from '../../common/comic-format-detect';
import type { RequestUser } from '../../common/types/request-user';
import { forEachWithConcurrency } from '../../common/utils/batch.utils';
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
const SERIES_BATCH_SIZE = 500;
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

type SeriesWriteAction = 'mark_read' | 'mark_unread' | 'tachiyomi_v1' | 'tachiyomi_v2';

interface SeriesWritePlan {
  action: SeriesWriteAction;
  shouldWrite: (record: KomgaBookRecord, index: number) => boolean;
  write: (record: KomgaBookRecord) => Promise<void>;
  finishedAfter?: (records: KomgaBookRecord[], nextIndex: number) => boolean;
}

export function isKomgaCompleted(record: KomgaBookRecord): boolean {
  return komgaReadProgressFor(record)?.completed === true;
}

// The first incomplete book ends the run, so records must be ordered by numberSort.
export class SeriesProgressAccumulator {
  private booksCount = 0;
  private booksReadCount = 0;
  private booksInProgressCount = 0;
  private lastReadContinuousIndex = 0;
  private lastReadContinuousNumberSort = 0;
  private runUnbroken = true;
  private maxNumberSort = 0;

  add(record: KomgaBookRecord): void {
    const progress = komgaReadProgressFor(record);
    this.booksCount += 1;
    if (progress?.completed) this.booksReadCount += 1;
    else if (progress) this.booksInProgressCount += 1;
    if (this.runUnbroken && progress?.completed) {
      this.lastReadContinuousIndex += 1;
      this.lastReadContinuousNumberSort = record.series.numberSort;
    } else {
      this.runUnbroken = false;
    }
    this.maxNumberSort = Math.max(this.maxNumberSort, record.series.numberSort);
  }

  summary(): KomgaSeriesProgressSummary {
    return {
      booksCount: this.booksCount,
      booksReadCount: this.booksReadCount,
      booksUnreadCount: this.booksCount - this.booksReadCount - this.booksInProgressCount,
      booksInProgressCount: this.booksInProgressCount,
      lastReadContinuousIndex: this.lastReadContinuousIndex,
      lastReadContinuousNumberSort: this.lastReadContinuousNumberSort,
      maxNumberSort: this.maxNumberSort,
    };
  }
}

export function summarizeSeriesProgress(records: readonly KomgaBookRecord[]): KomgaSeriesProgressSummary {
  const accumulator = new SeriesProgressAccumulator();
  for (const record of records) accumulator.add(record);
  return accumulator.summary();
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
    await this.writeSeries(user, account, seriesId, {
      action: 'mark_read',
      shouldWrite: (record) => !isKomgaCompleted(record),
      write: (record) => this.writeProgress(user, record, { completed: true }),
    });
  }

  async clearSeries(user: RequestUser, account: KomgaRequestAccount, seriesId: string): Promise<void> {
    await this.writeSeries(user, account, seriesId, {
      action: 'mark_unread',
      shouldWrite: (record) => komgaReadProgressFor(record) !== null,
      write: (record) => this.clearProgress(user, record),
    });
  }

  async tachiyomiProgressV1(user: RequestUser, account: KomgaRequestAccount, seriesId: string): Promise<KomgaTachiyomiProgressV1> {
    const summary = await this.summarizeSeries(user, account, seriesId);
    return {
      booksCount: summary.booksCount,
      booksReadCount: summary.booksReadCount,
      booksUnreadCount: summary.booksUnreadCount,
      booksInProgressCount: summary.booksInProgressCount,
      lastReadContinuousIndex: summary.lastReadContinuousIndex,
    };
  }

  async tachiyomiProgressV2(user: RequestUser, account: KomgaRequestAccount, seriesId: string): Promise<KomgaTachiyomiProgressV2> {
    const summary = await this.summarizeSeries(user, account, seriesId);
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
    await this.writeSeries(user, account, seriesId, {
      action: 'tachiyomi_v1',
      shouldWrite: (record, index) => index < lastBookRead && !isKomgaCompleted(record),
      write: (record) => this.writeProgress(user, record, { completed: true }),
      finishedAfter: (_records, nextIndex) => nextIndex >= lastBookRead,
    });
  }

  async markReadUpToNumberSort(user: RequestUser, account: KomgaRequestAccount, seriesId: string, lastBookNumberSortRead: number): Promise<void> {
    await this.writeSeries(user, account, seriesId, {
      action: 'tachiyomi_v2',
      shouldWrite: (record) => record.series.numberSort <= lastBookNumberSortRead && !isKomgaCompleted(record),
      write: (record) => this.writeProgress(user, record, { completed: true }),
      finishedAfter: (records) => (records.at(-1)?.series.numberSort ?? 0) > lastBookNumberSortRead,
    });
  }

  private async summarizeSeries(user: RequestUser, account: KomgaRequestAccount, seriesId: string): Promise<KomgaSeriesProgressSummary> {
    const accumulator = new SeriesProgressAccumulator();
    await this.seriesService.forEachBookBatch(user, account, seriesId, SERIES_BATCH_SIZE, (records) => {
      for (const record of records) accumulator.add(record);
    });
    return accumulator.summary();
  }

  private async writeSeries(user: RequestUser, account: KomgaRequestAccount, seriesId: string, plan: SeriesWritePlan): Promise<void> {
    const startedAt = Date.now();
    let visited = 0;
    let attempted = 0;
    this.logger.log(`[${SERIES_EVENT}] [start] seriesId=${seriesId} userId=${user.id} action=${plan.action} - series read progress update started`);
    try {
      await this.seriesService.forEachBookBatch(user, account, seriesId, SERIES_BATCH_SIZE, async (records, offset, total) => {
        const targets = records.filter((record, index) => plan.shouldWrite(record, offset + index));
        attempted += targets.length;
        await forEachWithConcurrency(targets, SERIES_WRITE_CONCURRENCY, plan.write);
        visited += records.length;
        if (total > SERIES_BATCH_SIZE) {
          this.logger.log(
            `[${SERIES_EVENT}] [progress] seriesId=${seriesId} userId=${user.id} action=${plan.action} position=${visited} total=${total} durationMs=${Date.now() - startedAt} updated=${attempted} - series read progress update in progress`,
          );
        }
        return plan.finishedAfter?.(records, offset + records.length) ? false : undefined;
      });
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(
          `[${SERIES_EVENT}] [fail] seriesId=${seriesId} userId=${user.id} action=${plan.action} durationMs=${Date.now() - startedAt} visited=${visited} attempted=${attempted} errorClass=${err.constructor.name} error="${sanitizeLogValue(err.message)}" - series read progress update failed`,
        );
      }
      throw error;
    }
    this.logger.log(
      `[${SERIES_EVENT}] [end] seriesId=${seriesId} userId=${user.id} action=${plan.action} durationMs=${Date.now() - startedAt} visited=${visited} updated=${attempted} - series read progress update completed`,
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
