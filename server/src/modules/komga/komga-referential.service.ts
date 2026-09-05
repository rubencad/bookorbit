import { Injectable } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import type { KomgaRequestAccount } from './komga-auth.guard';
import { KomgaCatalogRepository } from './komga-catalog.repository';
import type { KomgaAuthorRef } from './komga-catalog.types';
import { KomgaLibraryService } from './komga-library.service';
import type { ReferentialQuery } from './komga-query';
import { KOMGA_AUTHOR_ROLES } from './komga.constants';

export type KomgaReferentialKind = 'genre' | 'tag' | 'publisher' | 'language';

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

  async listAuthors(user: RequestUser, account: KomgaRequestAccount, query: ReferentialQuery): Promise<KomgaAuthorRef[]> {
    const scope = await this.libraryService.resolveScope(user, account, query.library_id);
    return this.repository.listReferentialAuthors(scope, query.search);
  }

  async listAuthorNames(user: RequestUser, account: KomgaRequestAccount, query: ReferentialQuery): Promise<string[]> {
    const refs = await this.listAuthors(user, account, query);
    return [...new Set(refs.map((ref) => ref.name))];
  }

  authorRoles(): string[] {
    return [...KOMGA_AUTHOR_ROLES];
  }
}
