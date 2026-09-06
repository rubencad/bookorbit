import { BadRequestException, Get, Headers, Param, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { OPDS_MIME_ACQ, OPDS_MIME_NAV, OPDS_MIME_SEARCH } from '../opds/opds-xml.helpers';
import { KomgaAccount } from './komga-account.decorator';
import type { KomgaRequestAccount } from './komga-auth.guard';
import { KomgaBookService } from './komga-book.service';
import { sendKomgaBookFile, sendKomgaPageImage } from './komga-file-response';
import { parseNumericId } from './komga-ids';
import { komgaOpdsSearchDescription } from './komga-opds.feed';
import { KomgaOpdsService } from './komga-opds.service';
import { KomgaController } from './komga-public.controller';
import { opdsFeedQuerySchema, opdsPageImageQuerySchema, parseKomgaQuery, type KomgaRawQuery } from './komga-query';
import { KomgaThumbnailService } from './komga-thumbnail.service';

@KomgaController('komga/opds')
export class KomgaOpdsController {
  constructor(
    private readonly opdsService: KomgaOpdsService,
    private readonly bookService: KomgaBookService,
    private readonly thumbnailService: KomgaThumbnailService,
  ) {}

  // Panels and other clients are pointed at a bare `/opds` address and discover the feed from
  // there. Serving the catalog body rather than redirecting keeps Basic credentials attached.
  @Get()
  root(@Res() reply: FastifyReply) {
    this.sendXml(reply, this.opdsService.catalog(), OPDS_MIME_NAV);
  }

  @Get('v1.2/catalog')
  catalog(@Res() reply: FastifyReply) {
    this.sendXml(reply, this.opdsService.catalog(), OPDS_MIME_NAV);
  }

  @Get('v1.2/search')
  search(@Res() reply: FastifyReply) {
    this.sendXml(reply, komgaOpdsSearchDescription(), OPDS_MIME_SEARCH);
  }

  @Get('v1.2/libraries')
  async libraries(@CurrentUser() user: RequestUser, @Res() reply: FastifyReply) {
    this.sendXml(reply, await this.opdsService.libraries(user), OPDS_MIME_NAV);
  }

  @Get('v1.2/libraries/:libraryId')
  async library(
    @CurrentUser() user: RequestUser,
    @KomgaAccount() account: KomgaRequestAccount,
    @Param('libraryId') libraryIdParam: string,
    @Query() query: KomgaRawQuery,
    @Res() reply: FastifyReply,
  ) {
    const libraryId = parseNumericId(libraryIdParam);
    if (libraryId === null) throw new BadRequestException('Library id must be a positive integer');
    const feed = await this.opdsService.librarySeries(user, account, libraryId, parseKomgaQuery(opdsFeedQuerySchema, query));
    this.sendXml(reply, feed, OPDS_MIME_NAV);
  }

  @Get('v1.2/series/latest')
  async latestSeries(
    @CurrentUser() user: RequestUser,
    @KomgaAccount() account: KomgaRequestAccount,
    @Query() query: KomgaRawQuery,
    @Res() reply: FastifyReply,
  ) {
    const feed = await this.opdsService.latestSeries(user, account, parseKomgaQuery(opdsFeedQuerySchema, query));
    this.sendXml(reply, feed, OPDS_MIME_NAV);
  }

  @Get('v1.2/series')
  async series(
    @CurrentUser() user: RequestUser,
    @KomgaAccount() account: KomgaRequestAccount,
    @Query() query: KomgaRawQuery,
    @Res() reply: FastifyReply,
  ) {
    const feed = await this.opdsService.series(user, account, parseKomgaQuery(opdsFeedQuerySchema, query));
    this.sendXml(reply, feed, OPDS_MIME_NAV);
  }

  @Get('v1.2/series/:seriesId')
  async seriesBooks(
    @CurrentUser() user: RequestUser,
    @KomgaAccount() account: KomgaRequestAccount,
    @Param('seriesId') seriesId: string,
    @Query() query: KomgaRawQuery,
    @Res() reply: FastifyReply,
  ) {
    const feed = await this.opdsService.seriesBooks(user, account, seriesId, parseKomgaQuery(opdsFeedQuerySchema, query));
    this.sendXml(reply, feed, OPDS_MIME_ACQ);
  }

  @Get('v1.2/books/latest')
  async latestBooks(
    @CurrentUser() user: RequestUser,
    @KomgaAccount() account: KomgaRequestAccount,
    @Query() query: KomgaRawQuery,
    @Res() reply: FastifyReply,
  ) {
    const feed = await this.opdsService.latestBooks(user, account, parseKomgaQuery(opdsFeedQuerySchema, query));
    this.sendXml(reply, feed, OPDS_MIME_ACQ);
  }

  @Get('v1.2/books/:bookId/thumbnail/small')
  async thumbnailSmall(
    @CurrentUser() user: RequestUser,
    @KomgaAccount() account: KomgaRequestAccount,
    @Param('bookId') bookIdParam: string,
    @Res() reply: FastifyReply,
    @Headers('if-none-match') ifNoneMatch?: string,
  ) {
    await this.sendThumbnail(user, account, bookIdParam, reply, ifNoneMatch);
  }

  @Get('v1.2/books/:bookId/thumbnail')
  async thumbnail(
    @CurrentUser() user: RequestUser,
    @KomgaAccount() account: KomgaRequestAccount,
    @Param('bookId') bookIdParam: string,
    @Res() reply: FastifyReply,
    @Headers('if-none-match') ifNoneMatch?: string,
  ) {
    await this.sendThumbnail(user, account, bookIdParam, reply, ifNoneMatch);
  }

  // OPDS-PSE page numbers start at 0, unlike the 1-based REST page endpoint.
  @Get('v1.2/books/:bookId/pages/:pageNumber')
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
    const { convert } = parseKomgaQuery(opdsPageImageQuerySchema, query);
    const image = await this.bookService.streamPage(user, account, this.parseBookId(bookIdParam), Number(pageNumberParam), {
      convert,
      zero_based: true,
    });
    sendKomgaPageImage(image, reply, ifNoneMatch);
  }

  @Get('v1.2/books/:bookId/file/:filename')
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

  private async sendThumbnail(
    user: RequestUser,
    account: KomgaRequestAccount,
    bookIdParam: string,
    reply: FastifyReply,
    ifNoneMatch?: string,
  ): Promise<void> {
    const bookId = await this.bookService.requireVisibleBookId(user, account, this.parseBookId(bookIdParam));
    await this.thumbnailService.send(bookId, reply, ifNoneMatch);
  }

  private parseBookId(value: string): number {
    const bookId = parseNumericId(value);
    if (bookId === null) throw new BadRequestException('Book id must be a positive integer');
    return bookId;
  }

  private sendXml(reply: FastifyReply, xml: string, mimeType: string): void {
    reply.type(`${mimeType}; charset=utf-8`).send(xml);
  }
}
