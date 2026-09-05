import { KomgaReferentialService } from '../komga-referential.service';
import { KOMGA_REFERENTIAL_MAX_ROWS } from '../komga.constants';

describe('KomgaReferentialService', () => {
  const scope = { libraryIds: [1] };
  const repository = {
    listReferentialValues: vi.fn(),
    listReferentialAuthors: vi.fn(),
  };
  const libraryService = { resolveScope: vi.fn().mockResolvedValue(scope) };
  const service = new KomgaReferentialService(repository as never, libraryService as never);
  const user = { id: 1 } as never;
  const account = { id: 2 } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    repository.listReferentialValues.mockResolvedValue({ values: ['Drama', 'Fantasy'], total: 2 });
    repository.listReferentialAuthors.mockResolvedValue({
      authors: [
        { name: 'Ann', role: 'writer' },
        { name: 'Bob', role: 'inker' },
      ],
      total: 2,
    });
  });

  it('queries scoped v1 values with the referential cap', async () => {
    await expect(service.listValues(user, account, 'genre', { library_id: [1] })).resolves.toEqual(['Drama', 'Fantasy']);
    expect(libraryService.resolveScope).toHaveBeenCalledWith(user, account, [1]);
    expect(repository.listReferentialValues).toHaveBeenCalledWith(scope, 'genre', {
      limit: KOMGA_REFERENTIAL_MAX_ROWS,
      offset: 0,
      search: undefined,
    });
  });

  it('returns v1 author references, unique names, and supported roles', async () => {
    repository.listReferentialAuthors.mockResolvedValue({
      authors: [
        { name: 'Ann', role: 'writer' },
        { name: 'Ann', role: 'penciller' },
        { name: 'Bob', role: 'inker' },
      ],
      total: 3,
    });
    await expect(service.listAuthors(user, account, { search: 'an' })).resolves.toHaveLength(3);
    expect(repository.listReferentialAuthors).toHaveBeenCalledWith(scope, { limit: KOMGA_REFERENTIAL_MAX_ROWS, offset: 0, search: 'an' });
    await expect(service.listAuthorNames(user, account, {})).resolves.toEqual(['Ann', 'Bob']);
    expect(service.authorRoles()).toEqual(['writer', 'penciller', 'inker', 'colorist', 'letterer', 'cover']);
  });

  it('passes v2 search and paging to the repository and uses its total', async () => {
    repository.listReferentialValues.mockResolvedValue({ values: ['Fantasy'], total: 3_000 });
    const second = await service.listValuesPage(user, account, 'genre', { page: 1, size: 1, search: 'fan' });
    expect(repository.listReferentialValues).toHaveBeenCalledWith(scope, 'genre', { search: 'fan', limit: 1, offset: 1 });
    expect(second).toMatchObject({ content: ['Fantasy'], totalElements: 3_000, totalPages: 3_000, number: 1, first: false, last: false });
  });

  it('marks capped unpaged v2 results as paged', async () => {
    repository.listReferentialValues.mockResolvedValue({ values: ['a', 'b'], total: 2 });
    const complete = await service.listValuesPage(user, account, 'tag', { unpaged: true });
    expect(repository.listReferentialValues).toHaveBeenCalledWith(scope, 'tag', { search: undefined, limit: KOMGA_REFERENTIAL_MAX_ROWS, offset: 0 });
    expect(complete.pageable).toMatchObject({ paged: false, unpaged: true });

    repository.listReferentialValues.mockResolvedValue({
      values: Array.from({ length: KOMGA_REFERENTIAL_MAX_ROWS }, (_, index) => `t${index}`),
      total: KOMGA_REFERENTIAL_MAX_ROWS + 1,
    });
    const capped = await service.listValuesPage(user, account, 'tag', { unpaged: true });
    expect(capped).toMatchObject({ totalElements: KOMGA_REFERENTIAL_MAX_ROWS + 1, totalPages: 2, last: false, size: KOMGA_REFERENTIAL_MAX_ROWS });
    expect(capped.pageable).toMatchObject({ paged: true, unpaged: false });
  });

  it('passes v2 author filters and paging to the repository', async () => {
    repository.listReferentialAuthors.mockResolvedValue({ authors: [{ name: 'Ann', role: 'penciller' }], total: 1 });
    const pencillers = await service.listAuthorsPage(user, account, { role: 'penciller', search: 'an', size: 2 });
    expect(repository.listReferentialAuthors).toHaveBeenCalledWith(scope, { search: 'an', role: 'penciller', limit: 2, offset: 0 });
    expect(pencillers).toMatchObject({ content: [{ name: 'Ann', role: 'penciller' }], totalElements: 1, totalPages: 1 });
  });

  it('returns an empty page with the requested size for unsupported v2 referentials', () => {
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
