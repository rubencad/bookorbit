import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { ComicPageRepository } from './comic-page.repository';
import { ComicPageService } from './comic-page.service';

export const STARTUP_BACKFILL_BATCH_SIZE = 200;

function errorClass(error: unknown): string {
  return error instanceof Error ? error.constructor.name : 'Error';
}

function errorMessage(error: unknown): string {
  return sanitizeLogValue(error instanceof Error ? error.message : String(error));
}

/**
 * Backfill missing page metadata so OPDS does not have to wait for later scans or reads.
 * Run asynchronously because large libraries may take minutes.
 */
@Injectable()
export class ComicPageBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ComicPageBackfillService.name);

  constructor(
    private readonly repository: ComicPageRepository,
    private readonly comicPageService: ComicPageService,
  ) {}

  onApplicationBootstrap(): void {
    void this.run();
  }

  async run(): Promise<void> {
    const event = 'comic.page_count_startup_backfill';
    const startedAt = Date.now();
    let cursor = 0;
    let scanned = 0;
    let counted = 0;
    let failed = 0;

    try {
      for (;;) {
        const files = await this.repository.findFilesMissingPageInfoAfter(cursor, STARTUP_BACKFILL_BATCH_SIZE);
        if (files.length === 0) break;
        if (scanned === 0) {
          this.logger.log(`[${event}] [start] batchSize=${STARTUP_BACKFILL_BATCH_SIZE} - startup comic page count backfill started`);
        }

        for (const file of files) {
          // Advance past every candidate, so a file that always fails cannot stall the run.
          cursor = file.id;
          scanned++;
          const fileStartedAt = Date.now();
          try {
            await this.comicPageService.refreshPageCount(file);
            counted++;
          } catch (error) {
            failed++;
            this.logger.warn(
              `[${event}] [fail] fileId=${file.id} path="${sanitizeLogValue(file.absolutePath)}" durationMs=${Date.now() - fileStartedAt} errorClass=${errorClass(error)} error="${errorMessage(error)}" - comic page count failed for file`,
            );
          }
        }

        this.logger.log(
          `[${event}] [progress] cursor=${cursor} batchSize=${STARTUP_BACKFILL_BATCH_SIZE} durationMs=${Date.now() - startedAt} scanned=${scanned} counted=${counted} failed=${failed} - startup comic page count backfill batch completed`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `[${event}] [fail] durationMs=${Date.now() - startedAt} scanned=${scanned} counted=${counted} failed=${failed} errorClass=${errorClass(error)} error="${errorMessage(error)}" - startup comic page count backfill aborted`,
      );
      return;
    }

    if (scanned === 0) return;
    this.logger.log(
      `[${event}] [end] durationMs=${Date.now() - startedAt} scanned=${scanned} counted=${counted} failed=${failed} - startup comic page count backfill completed`,
    );
  }
}
