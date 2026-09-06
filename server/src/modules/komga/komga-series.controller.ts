import { Body, Get, Headers, HttpCode, HttpStatus, Param, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { KomgaAccount } from './komga-account.decorator';
import type { KomgaRequestAccount } from './komga-auth.guard';
import { KomgaController } from './komga-public.controller';
import {
  emptyPageQuerySchema,
  parseKomgaQuery,
  seriesBooksQuerySchema,
  seriesListQuerySchema,
  seriesRecentQuerySchema,
  type KomgaRawQuery,
} from './komga-query';
import { parseKomgaSeriesSearch } from './komga-search-condition';
import { KomgaSeriesService } from './komga-series.service';
import { KomgaThumbnailService } from './komga-thumbnail.service';

@KomgaController('komga/api/v1/series')
export class KomgaSeriesController {
  constructor(
    private readonly seriesService: KomgaSeriesService,
    private readonly thumbnailService: KomgaThumbnailService,
  ) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Query() query: KomgaRawQuery) {
    return this.seriesService.list(user, account, parseKomgaQuery(seriesListQuerySchema, query));
  }

  @Post('list')
  @HttpCode(HttpStatus.OK)
  search(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Query() query: KomgaRawQuery, @Body() body: unknown) {
    return this.seriesService.search(user, account, parseKomgaSeriesSearch(body), parseKomgaQuery(emptyPageQuerySchema, query));
  }

  @Get('new')
  newSeries(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Query() query: KomgaRawQuery) {
    return this.seriesService.listRecent(user, account, 'new', parseKomgaQuery(seriesRecentQuerySchema, query));
  }

  @Get('updated')
  updatedSeries(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Query() query: KomgaRawQuery) {
    return this.seriesService.listRecent(user, account, 'updated', parseKomgaQuery(seriesRecentQuerySchema, query));
  }

  @Get('latest')
  latestSeries(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Query() query: KomgaRawQuery) {
    return this.seriesService.listRecent(user, account, 'latest', parseKomgaQuery(seriesRecentQuerySchema, query));
  }

  @Get(':seriesId')
  get(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Param('seriesId') seriesId: string) {
    return this.seriesService.get(user, account, seriesId);
  }

  @Get(':seriesId/books')
  listBooks(
    @CurrentUser() user: RequestUser,
    @KomgaAccount() account: KomgaRequestAccount,
    @Param('seriesId') seriesId: string,
    @Query() query: KomgaRawQuery,
  ) {
    return this.seriesService.listBooks(user, account, seriesId, parseKomgaQuery(seriesBooksQuerySchema, query));
  }

  @Get(':seriesId/thumbnail')
  async thumbnail(
    @CurrentUser() user: RequestUser,
    @KomgaAccount() account: KomgaRequestAccount,
    @Param('seriesId') seriesId: string,
    @Res() reply: FastifyReply,
    @Headers('if-none-match') ifNoneMatch?: string,
  ) {
    const bookId = await this.seriesService.thumbnailBookId(user, account, seriesId);
    await this.thumbnailService.send(bookId, reply, ifNoneMatch);
  }
}
