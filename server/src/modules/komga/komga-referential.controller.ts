import { Get, Query } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { KomgaAccount } from './komga-account.decorator';
import type { KomgaRequestAccount } from './komga-auth.guard';
import { KomgaController } from './komga-public.controller';
import { parseKomgaQuery, referentialQuerySchema, type KomgaRawQuery } from './komga-query';
import { KomgaReferentialService } from './komga-referential.service';

@KomgaController('komga/api')
export class KomgaReferentialController {
  constructor(private readonly referentialService: KomgaReferentialService) {}

  @Get(['v1/genres', 'v2/genres'])
  genres(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Query() query: KomgaRawQuery) {
    return this.referentialService.listValues(user, account, 'genre', parseKomgaQuery(referentialQuerySchema, query));
  }

  @Get(['v1/tags', 'v1/tags/book', 'v1/tags/series', 'v2/tags'])
  tags(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Query() query: KomgaRawQuery) {
    return this.referentialService.listValues(user, account, 'tag', parseKomgaQuery(referentialQuerySchema, query));
  }

  @Get(['v1/publishers', 'v2/publishers'])
  publishers(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Query() query: KomgaRawQuery) {
    return this.referentialService.listValues(user, account, 'publisher', parseKomgaQuery(referentialQuerySchema, query));
  }

  @Get(['v1/languages', 'v2/languages'])
  languages(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Query() query: KomgaRawQuery) {
    return this.referentialService.listValues(user, account, 'language', parseKomgaQuery(referentialQuerySchema, query));
  }

  @Get(['v1/authors', 'v2/authors'])
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

  @Get(['v1/age-ratings', 'v2/age-ratings', 'v1/sharing-labels'])
  emptyReferential(): string[] {
    return [];
  }
}
