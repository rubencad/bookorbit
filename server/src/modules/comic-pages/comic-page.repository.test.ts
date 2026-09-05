import { PgDialect } from 'drizzle-orm/pg-core';

import { ComicPageRepository } from './comic-page.repository';

describe('ComicPageRepository', () => {
  it('writes the page count and media type only when either differs from the stored value', async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    const update = vi.fn().mockReturnValue({ set });
    const repository = new ComicPageRepository({ update } as any);

    await repository.updatePageCount(9, 12, 'image/png');

    expect(update).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ pageCount: 12, pageMediaType: 'image/png' });
    const query = new PgDialect().sqlToQuery(where.mock.calls[0][0]);
    expect(query.sql).toContain('"book_files"."id" = $1');
    expect(query.sql).toContain('("book_files"."page_count" is distinct from $2 or "book_files"."page_media_type" is distinct from $3)');
    expect(query.params).toEqual([9, 12, 'image/png']);
  });

  it('uses the same guard when clearing the page count', async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    const update = vi.fn().mockReturnValue({ set });
    const repository = new ComicPageRepository({ update } as any);

    await repository.updatePageCount(9, null, null);

    expect(set).toHaveBeenCalledWith({ pageCount: null, pageMediaType: null });
    const query = new PgDialect().sqlToQuery(where.mock.calls[0][0]);
    expect(query.sql).toContain('"book_files"."page_count" is distinct from $2');
    expect(query.sql).toContain('"book_files"."page_media_type" is distinct from $3');
    expect(query.params).toEqual([9, null, null]);
  });

  it('selects comic files missing a count or a media type from present books in the folder', async () => {
    const rows = [{ id: 3, absolutePath: '/books/a.cbz', format: 'cbz', pageCount: null, pageMediaType: null }];
    const limit = vi.fn().mockResolvedValue(rows);
    const orderBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ orderBy });
    const innerJoin = vi.fn().mockReturnValue({ where });
    const from = vi.fn().mockReturnValue({ innerJoin });
    const select = vi.fn().mockReturnValue({ from });
    const repository = new ComicPageRepository({ select } as any);

    await expect(repository.findFilesMissingPageInfo(7, 500)).resolves.toEqual(rows);

    const query = new PgDialect().sqlToQuery(where.mock.calls[0][0]);
    expect(query.sql).toContain('"book_files"."library_folder_id" = $1');
    expect(query.sql).toContain('"book_files"."role" = $2');
    expect(query.sql).toContain('"book_files"."format" in ($3, $4, $5)');
    expect(query.sql).toContain('("book_files"."page_count" is null or "book_files"."page_media_type" is null)');
    expect(query.sql).toContain('"books"."status" = $6');
    expect(query.params).toEqual([7, 'content', 'cbz', 'cbr', 'cb7', 'present']);
    expect(limit).toHaveBeenCalledWith(500);
  });
});
