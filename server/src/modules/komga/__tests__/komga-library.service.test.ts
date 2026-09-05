import { ForbiddenException } from '@nestjs/common';

import type { RequestUser } from '../../../common/types/request-user';
import type { KomgaRequestAccount } from '../komga-auth.guard';
import { KomgaLibraryService } from '../komga-library.service';

const USER = {
  id: 1,
  isSuperuser: false,
  contentFilters: { includeTagIds: [], includeGenreIds: [], excludeTagIds: [], excludeGenreIds: [] },
} as unknown as RequestUser;
const ACCOUNT: KomgaRequestAccount = { id: 3, userId: 1, username: 'mihon', groupUnknownSeries: false, includeNonComicBooks: true };

function makeService(accessible = [1, 2]) {
  const repository = {
    getAccessibleLibraryIds: vi.fn().mockResolvedValue(accessible),
    listLibraries: vi.fn().mockImplementation((ids: number[]) => Promise.resolve(ids.map((id) => ({ id, name: `Library ${id}` })))),
  };
  return { service: new KomgaLibraryService(repository as never), repository };
}

describe('KomgaLibraryService', () => {
  it('builds a scope from the user, the account options and the accessible libraries', async () => {
    const { service } = makeService();
    await expect(service.resolveScope(USER, ACCOUNT)).resolves.toEqual({
      userId: 1,
      isSuperuser: false,
      contentFilters: USER.contentFilters,
      includeNonComicBooks: true,
      groupUnknownSeries: false,
      libraryIds: [1, 2],
    });
  });

  it('narrows the scope to requested libraries and refuses inaccessible ones', async () => {
    const { service } = makeService();
    await expect(service.resolveScope(USER, ACCOUNT, [2])).resolves.toMatchObject({ libraryIds: [2] });
    await expect(service.resolveScope(USER, ACCOUNT, [2, 3])).rejects.toThrow(ForbiddenException);
    await expect(service.resolveScope(USER, ACCOUNT, [])).resolves.toMatchObject({ libraryIds: [1, 2] });
  });

  it('lists accessible libraries and refuses single libraries outside the set', async () => {
    const { service, repository } = makeService();
    await expect(service.listLibraries(USER)).resolves.toEqual([
      { id: 1, name: 'Library 1' },
      { id: 2, name: 'Library 2' },
    ]);
    await expect(service.getLibrary(USER, 2)).resolves.toEqual({ id: 2, name: 'Library 2' });
    await expect(service.getLibrary(USER, 9)).rejects.toThrow(ForbiddenException);
    repository.listLibraries.mockResolvedValue([]);
    await expect(service.getLibrary(USER, 1)).rejects.toThrow(ForbiddenException);
  });
});
