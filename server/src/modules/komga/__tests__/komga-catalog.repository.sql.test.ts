import { drizzle } from 'drizzle-orm/node-postgres';

import * as schema from '../../../db/schema';
import { KomgaCatalogRepository } from '../komga-catalog.repository';
import type { KomgaScope } from '../komga-catalog.types';

// A real drizzle instance over a stub client compiles the exact SQL production sends; the mocked
// repository suite can only assert on result mapping.
function makeRepository() {
  const queries: string[] = [];
  const client = {
    query: (config: { text: string } | string) => {
      queries.push(typeof config === 'string' ? config : config.text);
      return Promise.resolve({ rows: [], fields: [] });
    },
  };
  const db = drizzle({ client: client as never, schema });
  return { repository: new KomgaCatalogRepository(db as never), queries };
}

const SCOPE: KomgaScope = {
  userId: 7,
  isSuperuser: true,
  contentFilters: { includeTagIds: [], includeGenreIds: [], excludeTagIds: [], excludeGenreIds: [] },
  includeNonComicBooks: false,
  groupUnknownSeries: true,
  libraryIds: [2],
};
const PAGE = { page: 0, size: 20, offset: 0, unpaged: false, sort: [] };

describe('KomgaCatalogRepository SQL', () => {
  it('sorts books by the progress read date and falls back to the status completion date', async () => {
    const { repository, queries } = makeRepository();
    await repository.listBooks(SCOPE, {}, { ...PAGE, sort: [{ property: 'readProgress.readDate', direction: 'desc' }] });

    const [listing] = queries;
    const orderBy = listing.slice(listing.indexOf('order by'));
    expect(orderBy).toContain('coalesce((SELECT max("reading_progress"."last_read_at")');
    expect(orderBy).toContain('(SELECT max(coalesce("user_book_status"."finished_at", "user_book_status"."updated_at"))');
    expect(orderBy).toContain(`"user_book_status"."status" = 'read')) DESC NULLS LAST`);
  });
});
