import { Test } from '@nestjs/testing';

import { ComicPageBackfillService, STARTUP_BACKFILL_BATCH_SIZE } from './comic-page-backfill.service';
import { ComicPageRepository } from './comic-page.repository';
import { ComicPagesModule } from './comic-pages.module';

function makeFiles(ids: number[]) {
  return ids.map((id) => ({ id, absolutePath: `/books/${id}.cbz`, format: 'cbz', pageCount: null, pageMediaType: null }));
}

function makeService(batches: unknown[][]) {
  const queue = [...batches];
  const repository = { findFilesMissingPageInfoAfter: vi.fn().mockImplementation(() => Promise.resolve(queue.shift() ?? [])) };
  const comicPageService = { refreshPageCount: vi.fn().mockResolvedValue(1) };
  const service = new ComicPageBackfillService(repository as never, comicPageService as never);
  const log = vi.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
  const warn = vi.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
  return { service, repository, comicPageService, log, warn };
}

function progressLines(log: ReturnType<typeof makeService>['log']): string[] {
  return log.mock.calls.map((call) => call[0] as string).filter((line) => line.includes('[progress]'));
}

describe('ComicPageBackfillService', () => {
  it('drains every batch, advancing the cursor past the last row it saw', async () => {
    const { service, repository, comicPageService } = makeService([makeFiles([3, 7]), makeFiles([9])]);

    await service.run();

    expect(repository.findFilesMissingPageInfoAfter.mock.calls).toEqual([
      [0, STARTUP_BACKFILL_BATCH_SIZE],
      [7, STARTUP_BACKFILL_BATCH_SIZE],
      [9, STARTUP_BACKFILL_BATCH_SIZE],
    ]);
    expect(comicPageService.refreshPageCount).toHaveBeenCalledTimes(3);
  });

  it('keeps going past a file it cannot count instead of retrying it', async () => {
    const { service, repository, comicPageService, log, warn } = makeService([makeFiles([4, 5])]);
    comicPageService.refreshPageCount.mockRejectedValueOnce(new Error('bad archive'));

    await service.run();

    expect(comicPageService.refreshPageCount).toHaveBeenCalledTimes(2);
    expect(repository.findFilesMissingPageInfoAfter).toHaveBeenLastCalledWith(5, STARTUP_BACKFILL_BATCH_SIZE);
    expect(warn.mock.calls[0]![0]).toMatch(
      /^\[comic\.page_count_startup_backfill\] \[fail\] fileId=4 path="\/books\/4\.cbz" durationMs=\d+ errorClass=Error error="bad archive"/,
    );
    expect(progressLines(log)[0]).toMatch(/\[progress\] cursor=5 batchSize=200 durationMs=\d+ scanned=2 counted=1 failed=1/);
  });

  it('logs the cursor and cumulative counts after each batch', async () => {
    const { service, log } = makeService([makeFiles([3, 7]), makeFiles([9])]);

    await service.run();

    const progress = progressLines(log);
    expect(progress).toHaveLength(2);
    expect(progress[0]).toMatch(
      /^\[comic\.page_count_startup_backfill\] \[progress\] cursor=7 batchSize=200 durationMs=\d+ scanned=2 counted=2 failed=0/,
    );
    expect(progress[1]).toMatch(/\[progress\] cursor=9 batchSize=200 durationMs=\d+ scanned=3 counted=3 failed=0/);

    const endLine = log.mock.calls.map((call) => call[0] as string).find((line) => line.includes('[end]'));
    expect(endLine).toMatch(/^\[comic\.page_count_startup_backfill\] \[end\] durationMs=\d+ scanned=3 counted=3 failed=0/);
  });

  it('stops and reports when the lookup itself fails', async () => {
    const { service, repository, comicPageService, warn } = makeService([]);
    repository.findFilesMissingPageInfoAfter.mockRejectedValueOnce(new Error('db down'));

    await expect(service.run()).resolves.toBeUndefined();

    expect(comicPageService.refreshPageCount).not.toHaveBeenCalled();
    expect(warn.mock.calls[0]![0]).toMatch(
      /^\[comic\.page_count_startup_backfill\] \[fail\] durationMs=\d+ scanned=0 counted=0 failed=0 errorClass=Error error="db down"/,
    );
  });

  it('stays quiet when no file is missing a page count', async () => {
    const { service, comicPageService, log } = makeService([]);

    await service.run();

    expect(comicPageService.refreshPageCount).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('starts the backfill when the application boots', async () => {
    const findFilesMissingPageInfoAfter = vi.fn().mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({ imports: [ComicPagesModule] })
      .overrideProvider(ComicPageRepository)
      .useValue({ findFilesMissingPageInfoAfter })
      .compile();

    await moduleRef.init();

    await vi.waitFor(() => expect(findFilesMissingPageInfoAfter).toHaveBeenCalledWith(0, STARTUP_BACKFILL_BATCH_SIZE));
    await moduleRef.close();
  });
});
