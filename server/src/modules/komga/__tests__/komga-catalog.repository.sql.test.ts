import { drizzle } from 'drizzle-orm/node-postgres';

import * as schema from '../../../db/schema';
import { KomgaCatalogRepository } from '../komga-catalog.repository';
import type { KomgaScope } from '../komga-catalog.types';
import { parseKomgaSeriesSearch } from '../komga-search-condition';

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

  it('selects named-series candidates by seriesId', async () => {
    const { repository, queries } = makeRepository();
    const { condition } = parseKomgaSeriesSearch({ condition: { tag: { operator: 'is', value: 'space' } } });
    await repository.listSeries(SCOPE, { condition }, PAGE);

    const [listing, count] = queries;
    for (const text of [listing, count]) {
      const outer = text.slice(text.lastIndexOf(') AS series WHERE'));
      expect(outer).toContain('"book_series_memberships"."series_id" = series.series_id');
      expect(outer).toContain('UNION ALL SELECT series.book_id WHERE series.book_id IS NOT NULL');
      expect(outer).toContain('"candidate"."library_id" = series.library_id');
      expect(outer).not.toContain('CASE');
    }
  });

  it('reads series release dates from the grouped source rather than a correlated aggregate', async () => {
    const { repository, queries } = makeRepository();
    const { condition } = parseKomgaSeriesSearch({ condition: { releaseDate: { operator: 'before', dateTime: '2020-01-01T00:00:00Z' } } });
    await repository.listSeries({ ...SCOPE, groupUnknownSeries: false }, { condition }, PAGE);

    const [listing] = queries;
    expect(listing).toContain('min("book_metadata"."published_date") AS release_date');
    expect(listing).toContain('"book_metadata"."published_date" AS release_date');
    expect(listing.slice(listing.lastIndexOf(') AS series WHERE'))).toContain('series.release_date < $');
    expect(listing.match(/min\("book_metadata"\."published_date"\)/g)).toHaveLength(1);
  });

  it('keeps member conditions inside the library of the series row', async () => {
    const { repository, queries } = makeRepository();
    const { condition } = parseKomgaSeriesSearch({ condition: { tag: { operator: 'is', value: 'space' } } });
    await repository.listSeries({ ...SCOPE, libraryIds: [2, 3] }, { condition }, PAGE);

    const [listing] = queries;
    const outer = listing.slice(listing.lastIndexOf(') AS series WHERE'));
    expect(outer).toContain('"books"."library_id" = series.library_id AND');
  });
});
