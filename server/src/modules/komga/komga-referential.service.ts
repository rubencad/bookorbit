import { Injectable } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import type { KomgaRequestAccount } from './komga-auth.guard';
import { KomgaCatalogRepository } from './komga-catalog.repository';
import type { KomgaAuthorRef } from './komga-catalog.types';
import { KomgaLibraryService } from './komga-library.service';
import { buildKomgaPage, resolvePageRequest, type KomgaPage, type ResolvePageRequestOptions } from './komga-page-response';
import type { ReferentialPageQuery, ReferentialQuery } from './komga-query';
import { KOMGA_AUTHOR_ROLES } from './komga.constants';

export type KomgaReferentialKind = 'genre' | 'tag' | 'publisher' | 'language';

const REFERENTIAL_PAGE_OPTIONS: ResolvePageRequestOptions = { defaultSort: [], sortableProperties: [], allowUnpaged: true };

function matchesSearch(value: string, search: string | undefined): boolean {
  const term = search?.trim().toLowerCase();
  return !term || value.toLowerCase().includes(term);
}

@Injectable()
export class KomgaReferentialService {
  constructor(
    private readonly repository: KomgaCatalogRepository,
    private readonly libraryService: KomgaLibraryService,
  ) {}

  async listValues(user: RequestUser, account: KomgaRequestAccount, kind: KomgaReferentialKind, query: ReferentialQuery): Promise<string[]> {
    const scope = await this.libraryService.resolveScope(user, account, query.library_id);
    return this.repository.listReferentialValues(scope, kind);
  }

  async listValuesPage(
    user: RequestUser,
    account: KomgaRequestAccount,
    kind: KomgaReferentialKind,
    query: ReferentialPageQuery,
  ): Promise<KomgaPage<string>> {
    const page = resolvePageRequest(query, REFERENTIAL_PAGE_OPTIONS);
    const values = (await this.listValues(user, account, kind, query)).filter((value) => matchesSearch(value, query.search));
    return buildKomgaPage(values.slice(page.offset, page.offset + page.size), page, values.length);
  }

  async listAuthors(user: RequestUser, account: KomgaRequestAccount, query: ReferentialQuery): Promise<KomgaAuthorRef[]> {
    const scope = await this.libraryService.resolveScope(user, account, query.library_id);
    return this.repository.listReferentialAuthors(scope, query.search);
  }

  async listAuthorsPage(user: RequestUser, account: KomgaRequestAccount, query: ReferentialPageQuery): Promise<KomgaPage<KomgaAuthorRef>> {
    const page = resolvePageRequest(query, REFERENTIAL_PAGE_OPTIONS);
    const role = query.role?.trim().toLowerCase();
    const refs = (await this.listAuthors(user, account, query)).filter((ref) => !role || ref.role === role);
    return buildKomgaPage(refs.slice(page.offset, page.offset + page.size), page, refs.length);
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
