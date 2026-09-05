import { Injectable } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import type { KomgaRequestAccount } from './komga-auth.guard';
import { KomgaCatalogRepository } from './komga-catalog.repository';
import type { KomgaAuthorRef } from './komga-catalog.types';
import { KomgaLibraryService } from './komga-library.service';
import { buildKomgaPage, resolvePageRequest, type KomgaPage, type ResolvePageRequestOptions } from './komga-page-response';
import type { ReferentialPageQuery, ReferentialQuery } from './komga-query';
import { KOMGA_AUTHOR_ROLES, KOMGA_REFERENTIAL_MAX_ROWS } from './komga.constants';

export type KomgaReferentialKind = 'genre' | 'tag' | 'publisher' | 'language';

const REFERENTIAL_PAGE_OPTIONS: ResolvePageRequestOptions = {
  defaultSort: [],
  sortableProperties: [],
  allowUnpaged: true,
  unpagedMaxRows: KOMGA_REFERENTIAL_MAX_ROWS,
};
const V1_WINDOW = { limit: KOMGA_REFERENTIAL_MAX_ROWS, offset: 0 };

@Injectable()
export class KomgaReferentialService {
  constructor(
    private readonly repository: KomgaCatalogRepository,
    private readonly libraryService: KomgaLibraryService,
  ) {}

  async listValues(user: RequestUser, account: KomgaRequestAccount, kind: KomgaReferentialKind, query: ReferentialQuery): Promise<string[]> {
    const scope = await this.libraryService.resolveScope(user, account, query.library_id);
    const { values } = await this.repository.listReferentialValues(scope, kind, { ...V1_WINDOW, search: query.search });
    return values;
  }

  async listValuesPage(
    user: RequestUser,
    account: KomgaRequestAccount,
    kind: KomgaReferentialKind,
    query: ReferentialPageQuery,
  ): Promise<KomgaPage<string>> {
    const page = resolvePageRequest(query, REFERENTIAL_PAGE_OPTIONS);
    const scope = await this.libraryService.resolveScope(user, account, query.library_id);
    const { values, total } = await this.repository.listReferentialValues(scope, kind, {
      search: query.search,
      limit: page.size,
      offset: page.offset,
    });
    return buildKomgaPage(values, page, total);
  }

  async listAuthors(user: RequestUser, account: KomgaRequestAccount, query: ReferentialQuery): Promise<KomgaAuthorRef[]> {
    const scope = await this.libraryService.resolveScope(user, account, query.library_id);
    const { authors } = await this.repository.listReferentialAuthors(scope, { ...V1_WINDOW, search: query.search });
    return authors;
  }

  async listAuthorsPage(user: RequestUser, account: KomgaRequestAccount, query: ReferentialPageQuery): Promise<KomgaPage<KomgaAuthorRef>> {
    const page = resolvePageRequest(query, REFERENTIAL_PAGE_OPTIONS);
    const scope = await this.libraryService.resolveScope(user, account, query.library_id);
    const { authors, total } = await this.repository.listReferentialAuthors(scope, {
      search: query.search,
      role: query.role,
      limit: page.size,
      offset: page.offset,
    });
    return buildKomgaPage(authors, page, total);
  }

  async listAuthorNames(user: RequestUser, account: KomgaRequestAccount, query: ReferentialQuery): Promise<string[]> {
    const refs = await this.listAuthors(user, account, query);
    return [...new Set(refs.map((ref) => ref.name))];
  }

  authorRoles(): string[] {
    return [...KOMGA_AUTHOR_ROLES];
  }

  emptyPage<T>(query: ReferentialPageQuery): KomgaPage<T> {
    return buildKomgaPage<T>([], resolvePageRequest(query, REFERENTIAL_PAGE_OPTIONS), 0);
  }
}
