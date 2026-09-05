import { BadRequestException, Get, Headers, Param, Query, Res } from '@nestjs/common';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import type { FastifyReply } from 'fastify';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { contentDispositionHeader } from '../../common/utils/content-disposition.utils';
import { contentRangeHeader, resolveByteRange, unsatisfiableContentRangeHeader } from '../../common/utils/http-range.utils';
import { KomgaAccount } from './komga-account.decorator';
import type { KomgaRequestAccount } from './komga-auth.guard';
import { KomgaBookService } from './komga-book.service';
import { parseNumericId } from './komga-ids';
import { KomgaController } from './komga-public.controller';
import { bookListQuerySchema, pageImageQuerySchema, parseKomgaQuery, type KomgaRawQuery } from './komga-query';
import { KomgaThumbnailService } from './komga-thumbnail.service';
import { komgaMediaType, toKomgaPageDto } from './komga.mapper';

@KomgaController('komga/api/v1/books')
export class KomgaBookController {
  constructor(
    private readonly bookService: KomgaBookService,
    private readonly thumbnailService: KomgaThumbnailService,
  ) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Query() query: KomgaRawQuery) {
    return this.bookService.list(user, account, parseKomgaQuery(bookListQuerySchema, query));
  }

  @Get(':bookId')
  get(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Param('bookId') bookIdParam: string) {
    return this.bookService.get(user, account, this.parseBookId(bookIdParam));
  }

  @Get(':bookId/pages')
  async pages(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Param('bookId') bookIdParam: string) {
    const pages = await this.bookService.listPages(user, account, this.parseBookId(bookIdParam));
    return pages.map(toKomgaPageDto);
  }

  @Get(':bookId/pages/:pageNumber')
  async page(
    @CurrentUser() user: RequestUser,
    @KomgaAccount() account: KomgaRequestAccount,
    @Param('bookId') bookIdParam: string,
    @Param('pageNumber') pageNumberParam: string,
    @Query() query: KomgaRawQuery,
    @Res() reply: FastifyReply,
    @Headers('if-none-match') ifNoneMatch?: string,
  ) {
    if (!/^\d{1,6}$/.test(pageNumberParam)) throw new BadRequestException('Page number must be a non-negative integer');
    const image = await this.bookService.streamPage(
      user,
      account,
      this.parseBookId(bookIdParam),
      Number(pageNumberParam),
      parseKomgaQuery(pageImageQuerySchema, query),
    );
    reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
    if (ifNoneMatch === image.etag) {
      reply.status(304).send();
      return;
    }
    reply.header('Cache-Control', 'private, max-age=86400');
    reply.header('ETag', image.etag);
    reply.type(image.stream.mimeType);
    reply.send(image.stream.stream);
  }

  @Get(':bookId/thumbnail')
  async thumbnail(
    @CurrentUser() user: RequestUser,
    @KomgaAccount() account: KomgaRequestAccount,
    @Param('bookId') bookIdParam: string,
    @Res() reply: FastifyReply,
    @Headers('if-none-match') ifNoneMatch?: string,
  ) {
    const bookId = await this.bookService.requireVisibleBookId(user, account, this.parseBookId(bookIdParam));
    await this.thumbnailService.send(bookId, reply, ifNoneMatch);
  }

  @Get(':bookId/file')
  async file(
    @CurrentUser() user: RequestUser,
    @KomgaAccount() account: KomgaRequestAccount,
    @Param('bookId') bookIdParam: string,
    @Res() reply: FastifyReply,
    @Headers('range') rangeHeader?: string,
  ) {
    const { file, filename } = await this.bookService.resolveDownload(user, account, this.parseBookId(bookIdParam));
    const { size } = await stat(file.absolutePath);

    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Disposition', contentDispositionHeader('attachment', filename, 'download'));
    reply.type(komgaMediaType(file.format));

    const resolution = resolveByteRange(rangeHeader, size);
    if (resolution.kind === 'unsatisfiable') {
      reply.header('Content-Range', unsatisfiableContentRangeHeader(size));
      reply.status(416).send();
      return;
    }
    if (resolution.kind === 'partial') {
      const { start, end } = resolution.range;
      reply.header('Content-Range', contentRangeHeader(resolution.range, size));
      reply.header('Content-Length', end - start + 1);
      reply.status(206).send(createReadStream(file.absolutePath, { start, end }));
      return;
    }
    reply.header('Content-Length', size);
    reply.send(createReadStream(file.absolutePath));
  }

  private parseBookId(value: string): number {
    const bookId = parseNumericId(value);
    if (bookId === null) throw new BadRequestException('Book id must be a positive integer');
    return bookId;
  }
}
