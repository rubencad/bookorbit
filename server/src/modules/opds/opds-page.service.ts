import { Injectable, NotFoundException } from '@nestjs/common';

import { ComicPageService, type ComicPageImageFormat, type ComicPageStream } from '../comic-pages/comic-page.service';
import { OpdsBookService, type OpdsComicFileRef } from './opds-book.service';
import { pseConversionFor } from './opds-pse';

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

  async streamPage(file: OpdsComicFileRef, pageIndex: number, format: ComicPageImageFormat, maxWidth?: number): Promise<ComicPageStream> {
    const manifest = await this.comicPageService.getManifest(file);
    const page = pageIndex >= 0 ? manifest.pages[pageIndex] : undefined;
    if (!page) throw new NotFoundException(`Page ${pageIndex} out of range`);

    return this.comicPageService.streamPage(file, pageIndex, { maxWidth, convert: pseConversionFor(format, page.mimeType) });
  }
}
