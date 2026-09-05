import { PgDialect } from 'drizzle-orm/pg-core';

import { ComicPageRepository } from './comic-page.repository';

describe('ComicPageRepository', () => {
  it('writes the page count only when it differs from the stored value', async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    const update = vi.fn().mockReturnValue({ set });
    const repository = new ComicPageRepository({ update } as any);

    await repository.updatePageCount(9, 12);

    expect(update).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ pageCount: 12 });
    const query = new PgDialect().sqlToQuery(where.mock.calls[0][0]);
    expect(query.sql).toContain('"book_files"."id" = $1');
    expect(query.sql).toContain('"book_files"."page_count" is distinct from $2');
    expect(query.params).toEqual([9, 12]);
  });

  it('uses the same guard when clearing the page count', async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    const update = vi.fn().mockReturnValue({ set });
    const repository = new ComicPageRepository({ update } as any);

    await repository.updatePageCount(9, null);

    expect(set).toHaveBeenCalledWith({ pageCount: null });
    const query = new PgDialect().sqlToQuery(where.mock.calls[0][0]);
    expect(query.sql).toContain('"book_files"."page_count" is distinct from $2');
    expect(query.params).toEqual([9, null]);
  });
});
