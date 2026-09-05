import { Get, Query } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { KomgaAccount } from './komga-account.decorator';
import type { KomgaRequestAccount } from './komga-auth.guard';
import { KomgaController } from './komga-public.controller';
import { parseKomgaQuery, referentialPageQuerySchema, referentialQuerySchema, type KomgaRawQuery } from './komga-query';
import { KomgaReferentialService } from './komga-referential.service';

@KomgaController('komga/api')
export class KomgaReferentialController {
  constructor(private readonly referentialService: KomgaReferentialService) {}

  @Get('v1/genres')
  genres(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Query() query: KomgaRawQuery) {
    return this.referentialService.listValues(user, account, 'genre', parseKomgaQuery(referentialQuerySchema, query));
  }

  @Get(['v1/tags', 'v1/tags/book', 'v1/tags/series'])
  tags(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Query() query: KomgaRawQuery) {
    return this.referentialService.listValues(user, account, 'tag', parseKomgaQuery(referentialQuerySchema, query));
  }

  @Get('v1/publishers')
  publishers(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Query() query: KomgaRawQuery) {
    return this.referentialService.listValues(user, account, 'publisher', parseKomgaQuery(referentialQuerySchema, query));
  }

  @Get('v1/languages')
  languages(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Query() query: KomgaRawQuery) {
    return this.referentialService.listValues(user, account, 'language', parseKomgaQuery(referentialQuerySchema, query));
  }

  @Get('v1/authors')
  authors(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Query() query: KomgaRawQuery) {
    return this.referentialService.listAuthors(user, account, parseKomgaQuery(referentialQuerySchema, query));
  }

  @Get('v1/authors/names')
  authorNames(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Query() query: KomgaRawQuery) {
    return this.referentialService.listAuthorNames(user, account, parseKomgaQuery(referentialQuerySchema, query));
  }

  @Get('v1/authors/roles')
  authorRoles() {
    return this.referentialService.authorRoles();
  }

  @Get(['v1/age-ratings', 'v1/sharing-labels'])
  emptyReferential(): string[] {
    return [];
  }

  @Get('v2/genres')
  genresV2(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Query() query: KomgaRawQuery) {
    return this.referentialService.listValuesPage(user, account, 'genre', parseKomgaQuery(referentialPageQuerySchema, query));
  }

  @Get('v2/tags')
  tagsV2(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Query() query: KomgaRawQuery) {
    return this.referentialService.listValuesPage(user, account, 'tag', parseKomgaQuery(referentialPageQuerySchema, query));
  }

  @Get('v2/publishers')
  publishersV2(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Query() query: KomgaRawQuery) {
    return this.referentialService.listValuesPage(user, account, 'publisher', parseKomgaQuery(referentialPageQuerySchema, query));
  }

  @Get('v2/languages')
  languagesV2(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Query() query: KomgaRawQuery) {
    return this.referentialService.listValuesPage(user, account, 'language', parseKomgaQuery(referentialPageQuerySchema, query));
  }

  @Get('v2/authors')
  authorsV2(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Query() query: KomgaRawQuery) {
    return this.referentialService.listAuthorsPage(user, account, parseKomgaQuery(referentialPageQuerySchema, query));
  }

  @Get(['v2/age-ratings', 'v2/sharing-labels'])
  emptyReferentialV2(@Query() query: KomgaRawQuery) {
    return this.referentialService.emptyPage<never>(parseKomgaQuery(referentialPageQuerySchema, query));
  }
}
