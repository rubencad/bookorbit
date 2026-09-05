import { ForbiddenException, Injectable } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import type { KomgaRequestAccount } from './komga-auth.guard';
import { KomgaCatalogRepository } from './komga-catalog.repository';
import type { KomgaLibraryRecord, KomgaScope } from './komga-catalog.types';

@Injectable()
export class KomgaLibraryService {
  constructor(private readonly repository: KomgaCatalogRepository) {}

  async resolveScope(user: RequestUser, account: KomgaRequestAccount, libraryIds?: number[]): Promise<KomgaScope> {
    const accessible = await this.repository.getAccessibleLibraryIds(user.id, user.isSuperuser);
    let scoped = accessible;
    if (libraryIds && libraryIds.length > 0) {
      if (libraryIds.some((libraryId) => !accessible.includes(libraryId))) {
        throw new ForbiddenException('No access to this library');
      }
      scoped = libraryIds;
    }
    return {
      userId: user.id,
      isSuperuser: user.isSuperuser,
      contentFilters: user.contentFilters,
      includeNonComicBooks: account.includeNonComicBooks,
      groupUnknownSeries: account.groupUnknownSeries,
      libraryIds: scoped,
    };
  }

  async accessibleLibraryIds(user: RequestUser): Promise<number[]> {
    return this.repository.getAccessibleLibraryIds(user.id, user.isSuperuser);
  }

  async listLibraries(user: RequestUser): Promise<KomgaLibraryRecord[]> {
    const accessible = await this.repository.getAccessibleLibraryIds(user.id, user.isSuperuser);
    return this.repository.listLibraries(accessible);
  }

  async getLibrary(user: RequestUser, libraryId: number): Promise<KomgaLibraryRecord> {
    const accessible = await this.repository.getAccessibleLibraryIds(user.id, user.isSuperuser);
    if (!accessible.includes(libraryId)) throw new ForbiddenException('No access to this library');
    const [library] = await this.repository.listLibraries([libraryId]);
    if (!library) throw new ForbiddenException('No access to this library');
    return library;
  }
}
