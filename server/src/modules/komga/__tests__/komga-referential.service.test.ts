import { KomgaReferentialService } from '../komga-referential.service';
import { KOMGA_UNPAGED_MAX_ROWS } from '../komga.constants';

describe('KomgaReferentialService', () => {
  const scope = { libraryIds: [1] };
  const repository = {
    listReferentialValues: vi.fn().mockResolvedValue(['Drama', 'Fantasy', 'Romance']),
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scopes v1 values to the requested libraries and returns plain arrays', async () => {
    await expect(service.listValues(user, account, 'genre', { library_id: [1] })).resolves.toEqual(['Drama', 'Fantasy', 'Romance']);
    expect(libraryService.resolveScope).toHaveBeenCalledWith(user, account, [1]);
    expect(repository.listReferentialValues).toHaveBeenCalledWith(scope, 'genre');
  });

  it('returns v1 author references, deduplicated names and the fixed role list', async () => {
    await expect(service.listAuthors(user, account, { search: 'an' })).resolves.toHaveLength(3);
    expect(repository.listReferentialAuthors).toHaveBeenCalledWith(scope, 'an');
    await expect(service.listAuthorNames(user, account, {})).resolves.toEqual(['Ann', 'Bob']);
    expect(service.authorRoles()).toEqual(['writer', 'penciller', 'inker', 'colorist', 'letterer', 'cover']);
  });

  it('pages v2 values with Spring metadata and filters them by search', async () => {
    const second = await service.listValuesPage(user, account, 'genre', { page: 1, size: 1 });
    expect(second).toMatchObject({ content: ['Fantasy'], totalElements: 3, totalPages: 3, number: 1, first: false, last: false });

    const searched = await service.listValuesPage(user, account, 'genre', { search: 'MAN' });
    expect(searched).toMatchObject({ content: ['Romance'], totalElements: 1, first: true, last: true });

    const unpaged = await service.listValuesPage(user, account, 'genre', { unpaged: true });
    expect(unpaged.content).toEqual(['Drama', 'Fantasy', 'Romance']);
    expect(unpaged.pageable).toMatchObject({ paged: false, unpaged: true });
    expect(unpaged.size).toBeLessThanOrEqual(KOMGA_UNPAGED_MAX_ROWS);
  });

  it('pages v2 authors and narrows them by role', async () => {
    const all = await service.listAuthorsPage(user, account, { size: 2 });
    expect(all).toMatchObject({ totalElements: 3, totalPages: 2, last: false });
    expect(all.content).toEqual([
      { name: 'Ann', role: 'writer' },
      { name: 'Ann', role: 'penciller' },
    ]);

    const pencillers = await service.listAuthorsPage(user, account, { role: 'Penciller' });
    expect(pencillers).toMatchObject({ content: [{ name: 'Ann', role: 'penciller' }], totalElements: 1 });
  });

  it('answers unsupported v2 referentials with an empty page that honours the requested size', () => {
    expect(service.emptyPage({ size: 5 })).toMatchObject({
      content: [],
      totalElements: 0,
      totalPages: 0,
      size: 5,
      empty: true,
      first: true,
      last: true,
    });
  });
});
