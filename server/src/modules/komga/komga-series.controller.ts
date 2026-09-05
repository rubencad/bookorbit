import { Get, Param, Query } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { KomgaAccount } from './komga-account.decorator';
import type { KomgaRequestAccount } from './komga-auth.guard';
import { KomgaController } from './komga-public.controller';
import { parseKomgaQuery, seriesBooksQuerySchema, seriesListQuerySchema, type KomgaRawQuery } from './komga-query';
import { KomgaSeriesService } from './komga-series.service';

@KomgaController('komga/api/v1/series')
export class KomgaSeriesController {
  constructor(private readonly seriesService: KomgaSeriesService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Query() query: KomgaRawQuery) {
    return this.seriesService.list(user, account, parseKomgaQuery(seriesListQuerySchema, query));
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
}
