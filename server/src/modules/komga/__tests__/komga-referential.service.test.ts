import { KomgaReferentialService } from '../komga-referential.service';

describe('KomgaReferentialService', () => {
  const scope = { libraryIds: [1] };
  const repository = {
    listReferentialValues: vi.fn().mockResolvedValue(['Drama']),
    listReferentialAuthors: vi.fn().mockResolvedValue([
      { name: 'Ann', role: 'writer' },
      { name: 'Ann', role: 'penciller' },
      { name: 'Bob', role: 'inker' },
    ]),
  };
  const libraryService = { resolveScope: vi.fn().mockResolvedValue(scope) };
  const service = new KomgaReferentialService(repository as never, libraryService as never);
  const user = { id: 1 } as never;
  const account = { id: 2 } as never;

  it('scopes values to the requested libraries', async () => {
    await expect(service.listValues(user, account, 'genre', { library_id: [1] })).resolves.toEqual(['Drama']);
    expect(libraryService.resolveScope).toHaveBeenCalledWith(user, account, [1]);
    expect(repository.listReferentialValues).toHaveBeenCalledWith(scope, 'genre');
  });

  it('returns author references, deduplicated names and the fixed role list', async () => {
    await expect(service.listAuthors(user, account, { search: 'an' })).resolves.toHaveLength(3);
    expect(repository.listReferentialAuthors).toHaveBeenCalledWith(scope, 'an');
    await expect(service.listAuthorNames(user, account, {})).resolves.toEqual(['Ann', 'Bob']);
    expect(service.authorRoles()).toEqual(['writer', 'penciller', 'inker', 'colorist', 'letterer', 'cover']);
  });
});
