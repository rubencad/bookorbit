import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Stats } from 'fs';
import { stat } from 'fs/promises';
import sharp from 'sharp';
import { Readable } from 'stream';

import { StatsCache } from '../../common/cache/stats-cache';
import { detectComicContainerFormat, isComicContainerFormat, type ComicContainerFormat } from '../../common/comic-format-detect';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { ComicPageRepository } from './comic-page.repository';
import { extractCb7Page, listCb7Pages } from './lib/cb7-pages';
import { extractCbrPage, listCbrPages } from './lib/cbr-pages';
import { listCbzPages, streamCbzPage } from './lib/cbz-pages';
import type { CleanupFailureReporter } from './lib/cleanup-failure';
import { ComicArchiveError } from './lib/comic-archive-error';
import { uniformComicPageMediaType, type ComicPageEntry } from './lib/comic-page-entry';

export interface ComicFileRef {
  id: number;
  absolutePath: string;
  format: string | null;
  pageCount?: number | null;
  pageMediaType?: string | null;
}

export interface ComicPageManifest {
  format: ComicContainerFormat;
  pages: ComicPageEntry[];
  pageMediaType: string | null;
}

export type ComicPageImageFormat = 'jpeg' | 'png';

export interface ComicPageTransform {
  maxWidth?: number;
  convert?: ComicPageImageFormat;
}

export interface ComicPageStream {
  stream: NodeJS.ReadableStream;
  mimeType: string;
}

export interface ComicPageCountBackfill {
  attempted: number;
  counted: number;
  failed: number;
  moreRemaining: boolean;
}

export const MAX_EXTRACTED_PAGE_BYTES = 64 * 1024 * 1024;
export const MAX_QUEUED_PAGE_COUNTS = 500;

const MANIFEST_CACHE_SCOPE = 'manifest';
const MANIFEST_CACHE_TTL_MS = 15 * 60 * 1000;
const MANIFEST_CACHE_MAX_ENTRIES = 2_000;
const SLOW_PAGE_EXTRACTION_MS = 2_000;
const CONVERTED_JPEG_QUALITY = 85;

function errorClass(error: unknown): string {
  return error instanceof Error ? error.constructor.name : 'Error';
}

function errorMessage(error: unknown): string {
  return sanitizeLogValue(error instanceof Error ? error.message : String(error));
}

function toHttpException(error: unknown): unknown {
  if (error instanceof ComicArchiveError) return new UnprocessableEntityException(error.message);
  return error;
}

function isMissingFilesystemEntry(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

async function listPages(
  absolutePath: string,
  format: ComicContainerFormat,
  reportCleanupFailure: CleanupFailureReporter,
): Promise<ComicPageEntry[]> {
  if (format === 'cbz') return listCbzPages(absolutePath);
  if (format === 'cbr') return listCbrPages(absolutePath);
  return listCb7Pages(absolutePath, reportCleanupFailure);
}

function applyTransform(source: NodeJS.ReadableStream, mimeType: string, transform: ComicPageTransform): ComicPageStream {
  if (transform.maxWidth === undefined && transform.convert === undefined) return { stream: source, mimeType };

  let pipeline = sharp({ failOn: 'error' });
  if (transform.maxWidth !== undefined) pipeline = pipeline.resize({ width: transform.maxWidth, withoutEnlargement: true });
  if (transform.convert === 'jpeg') pipeline = pipeline.jpeg({ quality: CONVERTED_JPEG_QUALITY });
  if (transform.convert === 'png') pipeline = pipeline.png();

  return { stream: source.pipe(pipeline), mimeType: transform.convert ? `image/${transform.convert}` : mimeType };
}

@Injectable()
export class ComicPageService {
  private readonly logger = new Logger(ComicPageService.name);
  private readonly manifests = new StatsCache({ ttlMs: MANIFEST_CACHE_TTL_MS, maxEntries: MANIFEST_CACHE_MAX_ENTRIES });
  private readonly queuedFileIds = new Set<number>();
  private readonly queuedFiles: ComicFileRef[] = [];
  private draining = false;

  constructor(private readonly repository: ComicPageRepository) {}

  async getPageCount(file: ComicFileRef): Promise<number> {
    return (await this.getManifest(file)).pages.length;
  }

  async getManifest(file: ComicFileRef): Promise<ComicPageManifest> {
    const format = this.requireComicFormat(file.format);
    const fileStat = await this.statFile(file);
    const cacheKey = `${file.id}:${fileStat.mtimeMs}:${fileStat.size}`;

    return this.manifests.get(MANIFEST_CACHE_SCOPE, cacheKey, async () => {
      const manifest = await this.buildManifest(file, format);
      if (file.pageCount !== manifest.pages.length || file.pageMediaType !== manifest.pageMediaType) {
        await this.persistPageCount(file.id, manifest.pages.length, manifest.pageMediaType);
      }
      return manifest;
    });
  }

  async refreshPageCount(file: ComicFileRef): Promise<number> {
    const format = this.requireComicFormat(file.format);
    let manifest: ComicPageManifest;
    try {
      await this.statFile(file);
      manifest = await this.buildManifest(file, format);
    } catch (error) {
      // Drop the count from the previous file version.
      await this.persistPageCount(file.id, null, null);
      throw error;
    }
    await this.repository.updatePageCount(file.id, manifest.pages.length, manifest.pageMediaType);
    return manifest.pages.length;
  }

  async backfillPageCounts(libraryFolderId: number, limit: number): Promise<ComicPageCountBackfill> {
    const startedAt = Date.now();
    const candidates = await this.repository.findUncountedFiles(libraryFolderId, limit + 1);
    const files = candidates.slice(0, limit);
    const result: ComicPageCountBackfill = { attempted: files.length, counted: 0, failed: 0, moreRemaining: candidates.length > limit };

    for (const file of files) {
      try {
        await this.refreshPageCount(file);
        result.counted++;
      } catch (error) {
        result.failed++;
        this.logger.warn(
          `[comic.page_count_backfill] [fail] libraryFolderId=${libraryFolderId} fileId=${file.id} path="${sanitizeLogValue(file.absolutePath)}" errorClass=${errorClass(error)} error="${errorMessage(error)}" - comic page count backfill failed for file`,
        );
      }
    }

    if (files.length > 0) {
      this.logger.log(
        `[comic.page_count_backfill] [end] libraryFolderId=${libraryFolderId} attempted=${result.attempted} counted=${result.counted} failed=${result.failed} moreRemaining=${result.moreRemaining} durationMs=${Date.now() - startedAt} - comic page count backfill completed`,
      );
    }
    return result;
  }

  queuePageCount(file: ComicFileRef): boolean {
    if (this.queuedFileIds.has(file.id) || this.queuedFileIds.size >= MAX_QUEUED_PAGE_COUNTS) return false;
    this.queuedFileIds.add(file.id);
    this.queuedFiles.push(file);
    void this.drainQueuedPageCounts();
    return true;
  }

  private async drainQueuedPageCounts(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    const startedAt = Date.now();
    let counted = 0;
    let failed = 0;
    try {
      for (let file = this.queuedFiles.shift(); file; file = this.queuedFiles.shift()) {
        try {
          await this.refreshPageCount(file);
          counted++;
        } catch (error) {
          failed++;
          this.logger.warn(
            `[comic.page_count_queue] [fail] fileId=${file.id} errorClass=${errorClass(error)} error="${errorMessage(error)}" - queued comic page count failed`,
          );
        } finally {
          this.queuedFileIds.delete(file.id);
        }
      }
    } finally {
      this.draining = false;
    }
    this.logger.log(
      `[comic.page_count_queue] [end] counted=${counted} failed=${failed} durationMs=${Date.now() - startedAt} - queued comic page counts completed`,
    );
  }

  async streamPage(file: ComicFileRef, pageIndex: number, transform: ComicPageTransform = {}): Promise<ComicPageStream> {
    const manifest = await this.getManifest(file);
    const page = pageIndex >= 0 ? manifest.pages[pageIndex] : undefined;
    if (!page) throw new NotFoundException(`Page ${pageIndex} out of range`);

    const startedAt = Date.now();
    try {
      const source = await this.openPage(file.absolutePath, manifest.format, page, this.cleanupReporter(file));
      const durationMs = Date.now() - startedAt;
      if (durationMs > SLOW_PAGE_EXTRACTION_MS) {
        this.logger.warn(
          `[comic.page_stream] [end] fileId=${file.id} format=${manifest.format} pageIndex=${pageIndex} durationMs=${durationMs} - slow comic page extraction`,
        );
      }
      return applyTransform(source, page.mimeType, transform);
    } catch (error) {
      this.logger.warn(
        `[comic.page_stream] [fail] fileId=${file.id} format=${manifest.format} pageIndex=${pageIndex} durationMs=${Date.now() - startedAt} errorClass=${errorClass(error)} error="${errorMessage(error)}" - comic page extraction failed`,
      );
      throw toHttpException(error);
    }
  }

  private async openPage(
    absolutePath: string,
    format: ComicContainerFormat,
    page: ComicPageEntry,
    reportCleanupFailure: CleanupFailureReporter,
  ): Promise<NodeJS.ReadableStream> {
    if (format === 'cbz') return streamCbzPage(absolutePath, page);
    if (page.sizeBytes > MAX_EXTRACTED_PAGE_BYTES) {
      throw new ComicArchiveError(`Comic page is larger than the ${MAX_EXTRACTED_PAGE_BYTES} byte extraction limit`);
    }
    if (format === 'cbr') return extractCbrPage(absolutePath, page, reportCleanupFailure);
    return Readable.from(await extractCb7Page(absolutePath, page, reportCleanupFailure));
  }

  private cleanupReporter(file: ComicFileRef): CleanupFailureReporter {
    return (resource, error) =>
      this.logger.warn(
        `[comic.archive_cleanup] [fail] fileId=${file.id} resource="${sanitizeLogValue(resource)}" errorClass=${errorClass(error)} error="${errorMessage(error)}" - comic archive cleanup failed`,
      );
  }

  private async buildManifest(file: ComicFileRef, format: ComicContainerFormat): Promise<ComicPageManifest> {
    const startedAt = Date.now();
    try {
      const actualFormat = await detectComicContainerFormat(file.absolutePath, format);
      const pages = await listPages(file.absolutePath, actualFormat, this.cleanupReporter(file));
      this.logger.debug(
        `[comic.page_manifest] [end] fileId=${file.id} format=${actualFormat} pages=${pages.length} durationMs=${Date.now() - startedAt} - comic page manifest built`,
      );
      return { format: actualFormat, pages, pageMediaType: uniformComicPageMediaType(pages) };
    } catch (error) {
      this.logger.warn(
        `[comic.page_manifest] [fail] fileId=${file.id} format=${format} durationMs=${Date.now() - startedAt} errorClass=${errorClass(error)} error="${errorMessage(error)}" - comic page manifest failed`,
      );
      throw toHttpException(error);
    }
  }

  private async persistPageCount(fileId: number, pageCount: number | null, pageMediaType: string | null): Promise<void> {
    try {
      await this.repository.updatePageCount(fileId, pageCount, pageMediaType);
    } catch (error) {
      this.logger.warn(
        `[comic.page_count] [fail] fileId=${fileId} pageCount=${pageCount} errorClass=${errorClass(error)} error="${errorMessage(error)}" - could not persist comic page count`,
      );
    }
  }

  private async statFile(file: ComicFileRef): Promise<Stats> {
    try {
      return await stat(file.absolutePath);
    } catch (error) {
      if (isMissingFilesystemEntry(error)) throw new NotFoundException(`File ${file.id} not found on disk`);
      throw error;
    }
  }

  private requireComicFormat(format: string | null): ComicContainerFormat {
    if (!isComicContainerFormat(format)) throw new NotFoundException(`Unsupported comic format: ${format ?? ''}`);
    return format;
  }
}
