import { PgDialect } from 'drizzle-orm/pg-core';
import { sql, type SQL } from 'drizzle-orm';

import { parseKomgaBookSearch, parseKomgaSeriesSearch } from '../komga-search-condition';
import {
  compileKomgaBookCondition,
  compileKomgaSeriesCondition,
  komgaLikePattern,
  type KomgaBookPredicates,
  type KomgaSeriesPredicates,
} from '../komga-search.sql';

const dialect = new PgDialect();

function render(compiled: SQL): { text: string; params: unknown[] } {
  const query = dialect.sqlToQuery(compiled);
  return { text: query.sql, params: query.params };
}

// Use marker SQL to make boolean grouping easy to assert.
const book: KomgaBookPredicates = {
  library: (id) => sql`LIBRARY(${id})`,
  series: (key) => sql`SERIES(${JSON.stringify(key)})`,
  oneshot: () => sql`ONESHOT`,
  title: () => sql`TITLE`,
  releaseDate: () => sql`RELEASED`,
  readStatus: (statuses) => sql`READ_STATUS(${statuses.join('|')})`,
  term: (kind, name) => sql`TERM(${kind}, ${name})`,
  anyTerm: (kind) => sql`ANY_TERM(${kind})`,
  metadataText: (field, value) => sql`META(${field}, ${value})`,
  author: (match) => sql`AUTHOR(${match.name}, ${match.role})`,
  mediaStatus: (status) => sql`MEDIA_STATUS(${status})`,
  mediaProfile: (profile) => sql`MEDIA_PROFILE(${profile})`,
};
const series: KomgaSeriesPredicates = {
  book,
  memberExists: (predicate) => sql`MEMBER(${predicate})`,
  releaseDate: () => sql`SERIES_RELEASED`,
};

function bookSql(condition: unknown): { text: string; params: unknown[] } {
  return render(compileKomgaBookCondition(parseKomgaBookSearch({ condition }).condition!, book));
}

function seriesSql(condition: unknown): { text: string; params: unknown[] } {
  return render(compileKomgaSeriesCondition(parseKomgaSeriesSearch({ condition }).condition!, series));
}

describe('compileKomgaBookCondition', () => {
  it('joins allOf with AND, anyOf with OR and treats empty branches as no constraint', () => {
    const { text, params } = bookSql({
      allOf: [
        { libraryId: { operator: 'is', value: '4' } },
        { anyOf: [{ tag: { operator: 'is', value: 'space' } }, { tag: { operator: 'is', value: 'war' } }] },
        { anyOf: [] },
      ],
    });
    expect(text).toBe('(LIBRARY($1) and (TERM($2, $3) or TERM($4, $5)) and true)');
    expect(params).toEqual([4, 'tag', 'space', 'tag', 'war']);
  });

  it('negates isNot and doesNot operators and maps null checks onto any-term predicates', () => {
    expect(bookSql({ tag: { operator: 'isNot', value: 'space' } }).text).toBe('NOT (TERM($1, $2))');
    expect(bookSql({ tag: { operator: 'isNull' } }).text).toBe('NOT (ANY_TERM($1))');
    expect(bookSql({ tag: { operator: 'isNotNull' } }).text).toBe('ANY_TERM($1)');
    expect(bookSql({ readStatus: { operator: 'isNot', value: 'READ' } })).toEqual({ text: 'NOT (READ_STATUS($1))', params: ['READ'] });
    expect(bookSql({ mediaStatus: { operator: 'is', value: 'UNSUPPORTED' } })).toEqual({ text: 'MEDIA_STATUS($1)', params: ['UNSUPPORTED'] });
    expect(bookSql({ mediaProfile: { operator: 'isNot', value: 'EPUB' } })).toEqual({ text: 'NOT (MEDIA_PROFILE($1))', params: ['EPUB'] });
    expect(bookSql({ author: { operator: 'is', value: { name: 'Ann' } } })).toEqual({ text: 'AUTHOR($1, $2)', params: ['Ann', null] });
    expect(bookSql({ oneShot: { operator: 'isFalse' } }).text).toBe('NOT (ONESHOT)');
    expect(bookSql({ oneShot: { operator: 'isTrue' } }).text).toBe('ONESHOT');
  });

  it('compiles string operators into accent-insensitive patterns', () => {
    expect(bookSql({ title: { operator: 'contains', value: 'Sága 100%' } })).toEqual({
      text: 'public.bookorbit_unaccent(TITLE) ILIKE public.bookorbit_unaccent($1)',
      params: ['%Sága 100\\%%'],
    });
    expect(bookSql({ title: { operator: 'is', value: 'Saga' } }).params).toEqual(['Saga']);
    expect(bookSql({ title: { operator: 'beginsWith', value: 'Sa' } }).params).toEqual(['Sa%']);
    expect(bookSql({ title: { operator: 'endsWith', value: 'ga' } }).params).toEqual(['%ga']);
    expect(bookSql({ title: { operator: 'doesNotContain', value: 'x' } }).text).toMatch(/^NOT \(public\.bookorbit_unaccent\(TITLE\) ILIKE/);
    expect(bookSql({ title: { operator: 'isNot', value: 'x' } }).text).toMatch(/^NOT \(/);
    expect(komgaLikePattern({ operator: 'doesNotBeginWith', value: 'a_b' })).toBe('a\\_b%');
    expect(komgaLikePattern({ operator: 'doesNotEndWith', value: 'a' })).toBe('%a');
  });

  it('compiles date bounds against the release date column', () => {
    expect(bookSql({ releaseDate: { operator: 'before', dateTime: '2020-01-01T00:00:00Z' } })).toEqual({
      text: 'RELEASED < $1::date',
      params: ['2020-01-01'],
    });
    expect(bookSql({ releaseDate: { operator: 'after', dateTime: '2020-01-01' } }).text).toBe('RELEASED > $1::date');
    expect(bookSql({ releaseDate: { operator: 'isNull' } }).text).toBe('RELEASED IS NULL');
    expect(bookSql({ releaseDate: { operator: 'isNotNull' } }).text).toBe('RELEASED IS NOT NULL');
    const inTheLast = render(
      compileKomgaBookCondition(
        parseKomgaBookSearch({ condition: { releaseDate: { operator: 'isInTheLast', duration: 'P7D' } } }, () => new Date('2026-01-10T00:00:00Z'))
          .condition!,
        book,
      ),
    );
    expect(inTheLast).toEqual({ text: 'RELEASED >= $1::date', params: ['2026-01-03'] });
  });

  it('matches nothing for ids that are not BookOrbit ids and honours the deleted flag', () => {
    expect(bookSql({ libraryId: { operator: 'is', value: 'abc' } }).text).toBe('false');
    expect(bookSql({ libraryId: { operator: 'isNot', value: 'abc' } }).text).toBe('NOT (false)');
    expect(bookSql({ seriesId: { operator: 'is', value: 'nope' } }).text).toBe('false');
    expect(bookSql({ seriesId: { operator: 'is', value: '2-u' } })).toEqual({ text: 'SERIES($1)', params: ['{"kind":"unknown","libraryId":2}'] });
    expect(bookSql({ deleted: { operator: 'isTrue' } }).text).toBe('false');
    expect(bookSql({ deleted: { operator: 'isFalse' } }).text).toBe('true');
  });
});

describe('compileKomgaSeriesCondition', () => {
  it('evaluates series-level leaves against the grouped series row', () => {
    expect(seriesSql({ libraryId: { operator: 'is', value: '4' } })).toEqual({ text: 'series.library_id = $1', params: [4] });
    expect(seriesSql({ oneShot: { operator: 'isTrue' } }).text).toBe('series.book_id IS NOT NULL');
    expect(seriesSql({ oneShot: { operator: 'isFalse' } }).text).toBe('series.book_id IS NULL');
    expect(seriesSql({ complete: { operator: 'isTrue' } }).text).toBe(
      '(series.expected_book_count IS NOT NULL AND series.books_count >= series.expected_book_count)',
    );
    expect(seriesSql({ seriesStatus: { operator: 'is', value: 'ONGOING' } }).text).toBe(
      'NOT ((series.expected_book_count IS NOT NULL AND series.books_count >= series.expected_book_count))',
    );
    expect(seriesSql({ seriesStatus: { operator: 'is', value: 'HIATUS' } }).text).toBe('false');
    expect(seriesSql({ seriesStatus: { operator: 'isNot', value: 'ABANDONED' } }).text).toBe('NOT (false)');
    expect(seriesSql({ readStatus: { operator: 'is', value: 'READ' } }).text).toBe('series.books_read_count = series.books_count');
    expect(seriesSql({ readStatus: { operator: 'is', value: 'UNREAD' } }).text).toBe(
      '(series.books_read_count = 0 AND series.books_in_progress_count = 0)',
    );
    expect(seriesSql({ readStatus: { operator: 'isNot', value: 'IN_PROGRESS' } }).text).toBe(
      'NOT ((series.books_read_count < series.books_count AND (series.books_read_count > 0 OR series.books_in_progress_count > 0)))',
    );
    expect(seriesSql({ title: { operator: 'contains', value: 'saga' } })).toEqual({
      text: 'public.bookorbit_unaccent(series.name) ILIKE public.bookorbit_unaccent($1)',
      params: ['%saga%'],
    });
    expect(seriesSql({ titleSort: { operator: 'isNot', value: 'saga' } }).text).toMatch(/^NOT \(public\.bookorbit_unaccent\(series\.name\)/);
    expect(seriesSql({ releaseDate: { operator: 'after', dateTime: '2001-01-01' } })).toEqual({
      text: 'SERIES_RELEASED > $1::date',
      params: ['2001-01-01'],
    });
  });

  it('routes member-level leaves through a correlated member predicate', () => {
    expect(seriesSql({ tag: { operator: 'is', value: 'space' } })).toEqual({ text: 'MEMBER(TERM($1, $2))', params: ['tag', 'space'] });
    expect(seriesSql({ genre: { operator: 'isNot', value: 'Drama' } })).toEqual({ text: 'NOT (MEMBER(TERM($1, $2)))', params: ['genre', 'Drama'] });
    expect(seriesSql({ genre: { operator: 'isNull' } })).toEqual({ text: 'NOT (MEMBER(ANY_TERM($1)))', params: ['genre'] });
    expect(seriesSql({ publisher: { operator: 'is', value: 'Image' } })).toEqual({ text: 'MEMBER(META($1, $2))', params: ['publisher', 'Image'] });
    expect(seriesSql({ language: { operator: 'isNot', value: 'fr' } })).toEqual({ text: 'NOT (MEMBER(META($1, $2)))', params: ['language', 'fr'] });
    expect(seriesSql({ author: { operator: 'is', value: { name: 'Ann', role: 'writer' } } })).toEqual({
      text: 'MEMBER(AUTHOR($1, $2))',
      params: ['Ann', 'writer'],
    });
  });

  it('answers fixed values for data BookOrbit does not keep', () => {
    expect(seriesSql({ collectionId: { operator: 'is', value: 'x' } }).text).toBe('false');
    expect(seriesSql({ collectionId: { operator: 'isNot', value: 'x' } }).text).toBe('NOT (false)');
    expect(seriesSql({ sharingLabel: { operator: 'isNull' } }).text).toBe('true');
    expect(seriesSql({ sharingLabel: { operator: 'is', value: 'kids' } }).text).toBe('false');
    expect(seriesSql({ sharingLabel: { operator: 'isNot', value: 'kids' } }).text).toBe('true');
    expect(seriesSql({ ageRating: { operator: 'isNull' } }).text).toBe('true');
    expect(seriesSql({ ageRating: { operator: 'isNotNull' } }).text).toBe('false');
    expect(seriesSql({ ageRating: { operator: 'greaterThan', value: 12 } }).text).toBe('false');
    expect(seriesSql({ ageRating: { operator: 'isNot', value: 12 } }).text).toBe('true');
    expect(seriesSql({ deleted: { operator: 'isTrue' } }).text).toBe('false');
    expect(seriesSql({ allOf: [] }).text).toBe('true');
  });
});
