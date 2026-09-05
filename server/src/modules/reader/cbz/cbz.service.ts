import { Injectable } from '@nestjs/common';

import type { RequestUser } from '../../../common/types/request-user';
import { BookService } from '../../book/book.service';
import { ComicPageService, type ComicPageStream } from '../../comic-pages/comic-page.service';

@Injectable()
export class CbzService {
  constructor(
    private readonly bookService: BookService,
    private readonly comicPageService: ComicPageService,
  ) {}

  async getPageCount(fileId: number, user: RequestUser): Promise<number> {
    const file = await this.bookService.verifyFileAccess(fileId, user);
    return this.comicPageService.getPageCount(file);
  }

  async streamPage(fileId: number, pageIndex: number, user: RequestUser): Promise<ComicPageStream> {
    const file = await this.bookService.verifyFileAccess(fileId, user);
    return this.comicPageService.streamPage(file, pageIndex);
  }
}
