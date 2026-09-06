import { BadRequestException, Body, Get, Headers, HttpCode, HttpStatus, Param, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { KomgaAccount } from './komga-account.decorator';
import type { KomgaRequestAccount } from './komga-auth.guard';
import { KomgaBookService } from './komga-book.service';
import { sendKomgaBookFile, sendKomgaPageImage } from './komga-file-response';
import { parseNumericId } from './komga-ids';
import { KomgaController } from './komga-public.controller';
import {
  bookListQuerySchema,
  bookRecentQuerySchema,
  emptyPageQuerySchema,
  pageImageQuerySchema,
  parseKomgaQuery,
  type KomgaRawQuery,
} from './komga-query';
import { parseKomgaBookSearch } from './komga-search-condition';
import { KomgaThumbnailService } from './komga-thumbnail.service';
import { toKomgaPageDto } from './komga.mapper';

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

  @Post('list')
  @HttpCode(HttpStatus.OK)
  search(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Query() query: KomgaRawQuery, @Body() body: unknown) {
    return this.bookService.search(user, account, parseKomgaBookSearch(body), parseKomgaQuery(emptyPageQuerySchema, query));
  }

  @Get('latest')
  latest(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Query() query: KomgaRawQuery) {
    return this.bookService.listLatest(user, account, parseKomgaQuery(bookRecentQuerySchema, query));
  }

  @Get('ondeck')
  onDeck(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Query() query: KomgaRawQuery) {
    return this.bookService.listOnDeck(user, account, parseKomgaQuery(bookRecentQuerySchema, query));
  }

  @Get(':bookId')
  get(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Param('bookId') bookIdParam: string) {
    return this.bookService.get(user, account, this.parseBookId(bookIdParam));
  }

  @Get(':bookId/next')
  next(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Param('bookId') bookIdParam: string) {
    return this.bookService.getSibling(user, account, this.parseBookId(bookIdParam), 'next');
  }

  @Get(':bookId/previous')
  previous(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Param('bookId') bookIdParam: string) {
    return this.bookService.getSibling(user, account, this.parseBookId(bookIdParam), 'previous');
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
    sendKomgaPageImage(image, reply, ifNoneMatch);
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
    const download = await this.bookService.resolveDownload(user, account, this.parseBookId(bookIdParam));
    await sendKomgaBookFile(download, reply, rangeHeader);
  }

  private parseBookId(value: string): number {
    const bookId = parseNumericId(value);
    if (bookId === null) throw new BadRequestException('Book id must be a positive integer');
    return bookId;
  }
}
