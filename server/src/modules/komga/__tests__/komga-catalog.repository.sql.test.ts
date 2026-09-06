import { drizzle } from 'drizzle-orm/node-postgres';

import * as schema from '../../../db/schema';
import { KomgaCatalogRepository } from '../komga-catalog.repository';
import type { KomgaScope } from '../komga-catalog.types';
import { parseKomgaBookSearch, parseKomgaSeriesSearch } from '../komga-search-condition';

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

  it('joins metadata in the series results and count queries', async () => {
    const { repository, queries } = makeRepository();
    const { condition } = parseKomgaBookSearch({ condition: { title: { operator: 'contains', value: 'alpha' } } });
    await repository.listSeriesBooks(SCOPE, { kind: 'series', libraryId: 2, seriesId: 9 }, { search: 'alpha', condition }, PAGE);

    const [listing, count] = queries;
    expect(listing).toContain('left join "book_metadata"');
    expect(count).toMatch(/^select count\(\*\)::text/);
    expect(count).toContain('left join "book_metadata"');
    expect(count).toContain('"book_metadata"."title"');
  });

  it('preserves sort precedence and puts nulls last', async () => {
    const { repository, queries } = makeRepository();
    await repository.listSeriesBooks(
      SCOPE,
      { kind: 'series', libraryId: 2, seriesId: 9 },
      {},
      {
        ...PAGE,
        sort: [
          { property: 'metadata.releaseDate', direction: 'asc' },
          { property: 'metadata.title', direction: 'desc' },
        ],
      },
    );
    const [listing] = queries;
    const orderBy = listing.slice(listing.indexOf('order by'));
    const release = orderBy.indexOf('"book_metadata"."published_date" ASC NULLS LAST');
    const title = orderBy.indexOf('lower("book_metadata"."title") DESC NULLS LAST');
    const fallback = orderBy.indexOf('lower("book_metadata"."title") ASC NULLS LAST');
    expect(release).toBeGreaterThan(-1);
    expect(title).toBeGreaterThan(release);
    expect(fallback).toBeGreaterThan(title);

    const byReadDate = makeRepository();
    await byReadDate.repository.listSeriesBooks(
      SCOPE,
      { kind: 'unknown', libraryId: 2 },
      {},
      { ...PAGE, sort: [{ property: 'readProgress.readDate', direction: 'desc' }] },
    );
    expect(byReadDate.queries[0]).toContain(`"user_book_status"."status" = 'read')) DESC NULLS LAST`);
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
