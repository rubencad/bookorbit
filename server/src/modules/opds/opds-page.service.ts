import { Injectable, NotFoundException } from '@nestjs/common';

import { ComicPageService, type ComicPageStream } from '../comic-pages/comic-page.service';
import { OpdsBookService, type OpdsComicFileRef } from './opds-book.service';

// OPDS-PSE allows only JPEG, PNG, and GIF pages; every other page type is transcoded to the
// JPEG type the feed advertises.
const PASSTHROUGH_MIME_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/gif']);

export const OPDS_PAGE_MAX_WIDTH = 4096;

@Injectable()
export class OpdsPageService {
  constructor(
    private readonly opdsBookService: OpdsBookService,
    private readonly comicPageService: ComicPageService,
  ) {}

  async resolveComicFile(bookId: number, fileId?: number): Promise<OpdsComicFileRef> {
    const file = await this.opdsBookService.getComicFile(bookId, fileId);
    if (!file) throw new NotFoundException('Comic file not found');
    return file;
  }

  async streamPage(file: OpdsComicFileRef, pageIndex: number, maxWidth?: number): Promise<ComicPageStream> {
    const manifest = await this.comicPageService.getManifest(file);
    const page = pageIndex >= 0 ? manifest.pages[pageIndex] : undefined;
    if (!page) throw new NotFoundException(`Page ${pageIndex} out of range`);

    const convert = PASSTHROUGH_MIME_TYPES.has(page.mimeType) ? undefined : 'jpeg';
    return this.comicPageService.streamPage(file, pageIndex, { maxWidth, convert });
  }
}
