import { BadRequestException } from '@nestjs/common';

import {
  parseIsoDurationMs,
  parseKomgaBookSearch,
  parseKomgaSeriesSearch,
  requiredLibraryIds,
  requiredSeriesKey,
  restrictScopeToCondition,
} from '../komga-search-condition';
import type { KomgaScope } from '../komga-catalog.types';

const NOW = () => new Date('2026-03-15T12:00:00Z');

describe('parseKomgaSeriesSearch', () => {
  it('parses nested allOf and anyOf trees with every supported series leaf', () => {
    const parsed = parseKomgaSeriesSearch(
      {
        condition: {
          allOf: [
            { libraryId: { operator: 'is', value: '12' } },
            { anyOf: [{ title: { operator: 'contains', value: 'Saga' } }, { titleSort: { operator: 'beginsWith', value: 'S' } }] },
            { tag: { operator: 'isNull' } },
            { genre: { operator: 'isNot', value: 'Drama' } },
            { publisher: { operator: 'is', value: 'Image' } },
            { language: { operator: 'isNot', value: 'fr' } },
            { readStatus: { operator: 'is', value: 'IN_PROGRESS' } },
            { seriesStatus: { operator: 'isNot', value: 'ENDED' } },
            { complete: { operator: 'isTrue' } },
            { oneShot: { operator: 'isFalse' } },
            { deleted: { operator: 'isFalse' } },
            { ageRating: { operator: 'greaterThan', value: 12 } },
            { sharingLabel: { operator: 'isNotNull' } },
            { collectionId: { operator: 'is', value: 'abc' } },
            { author: { operator: 'is', value: { name: ' Ann ', role: 'Writer' } } },
            { releaseDate: { operator: 'after', dateTime: '2020-06-01T23:30:00+02:00' } },
          ],
        },
        fullTextSearch: '  batman ',
        extra: 'ignored',
      },
      NOW,
    );

    expect(parsed.fullTextSearch).toBe('batman');
    expect(parsed.condition).toEqual({
      kind: 'allOf',
      conditions: [
        { kind: 'libraryId', match: { operator: 'is', value: 12 } },
        {
          kind: 'anyOf',
          conditions: [
            { kind: 'title', match: { operator: 'contains', value: 'Saga' } },
            { kind: 'titleSort', match: { operator: 'beginsWith', value: 'S' } },
          ],
        },
        { kind: 'tag', match: { operator: 'isNull' } },
        { kind: 'genre', match: { operator: 'isNot', value: 'Drama' } },
        { kind: 'publisher', match: { operator: 'is', value: 'Image' } },
        { kind: 'language', match: { operator: 'isNot', value: 'fr' } },
        { kind: 'readStatus', match: { operator: 'is', value: 'IN_PROGRESS' } },
        { kind: 'seriesStatus', match: { operator: 'isNot', value: 'ENDED' } },
        { kind: 'complete', match: { operator: 'isTrue' } },
        { kind: 'oneShot', match: { operator: 'isFalse' } },
        { kind: 'deleted', match: { operator: 'isFalse' } },
        { kind: 'ageRating', match: { operator: 'greaterThan', value: 12 } },
        { kind: 'sharingLabel', match: { operator: 'isNotNull' } },
        { kind: 'collectionId', match: { operator: 'is', value: 'abc' } },
        { kind: 'author', match: { operator: 'is', value: { name: 'Ann', role: 'writer' } } },
        { kind: 'releaseDate', match: { operator: 'after', date: '2020-06-01' } },
      ],
    });
  });

  it('accepts a missing or null condition and blank full text search', () => {
    expect(parseKomgaSeriesSearch(undefined)).toEqual({ condition: null, fullTextSearch: undefined });
    expect(parseKomgaSeriesSearch({ condition: null, fullTextSearch: '   ' })).toEqual({ condition: null, fullTextSearch: undefined });
    expect(parseKomgaSeriesSearch({ condition: { allOf: [] } })).toEqual({ condition: { kind: 'allOf', conditions: [] }, fullTextSearch: undefined });
  });

  it('turns relative date operators into a date bound computed from now', () => {
    const inTheLast = parseKomgaSeriesSearch({ condition: { releaseDate: { operator: 'isInTheLast', duration: 'P30D' } } }, NOW);
    expect(inTheLast.condition).toEqual({ kind: 'releaseDate', match: { operator: 'onOrAfter', date: '2026-02-13' } });
    const notInTheLast = parseKomgaSeriesSearch({ condition: { releaseDate: { operator: 'isNotInTheLast', duration: 'PT36H' } } }, NOW);
    expect(notInTheLast.condition).toEqual({ kind: 'releaseDate', match: { operator: 'before', date: '2026-03-14' } });
    expect(parseKomgaSeriesSearch({ condition: { releaseDate: { operator: 'isNull' } } }).condition).toEqual({
      kind: 'releaseDate',
      match: { operator: 'isNull' },
    });
  });

  it('rejects invalid conditions and identifies the failing field', () => {
    const cases: Array<[unknown, RegExp]> = [
      [{ condition: { poster: { operator: 'is', value: {} } } }, /Unknown search condition: poster/],
      [{ condition: { seriesId: { operator: 'is', value: '1-s2' } } }, /Unknown search condition: seriesId/],
      [{ condition: { tag: { operator: 'contains', value: 'x' } } }, /condition\.tag/],
      [{ condition: { readStatus: { operator: 'is', value: 'SKIMMED' } } }, /condition\.readStatus\.value/],
      [{ condition: { seriesStatus: { operator: 'is', value: 'PAUSED' } } }, /condition\.seriesStatus/],
      [
        { condition: { allOf: [{ tag: { operator: 'is', value: 'a' }, genre: { operator: 'is', value: 'b' } }] } },
        /condition\.allOf\.0: expected exactly one/,
      ],
      [{ condition: { allOf: 'x' } }, /condition\.allOf: expected an array/],
      [{ condition: { anyOf: [null] } }, /condition\.anyOf\.0/],
      [{ condition: 'tag' }, /expected an object/],
      [{ condition: { releaseDate: { operator: 'before', dateTime: 'yesterday' } } }, /not a date/],
      [{ condition: { releaseDate: { operator: 'isInTheLast', duration: '30 days' } } }, /ISO 8601 duration/],
      [{ condition: { ageRating: { operator: 'is', value: 'twelve' } } }, /condition\.ageRating/],
      [{ fullTextSearch: 42 }, /Invalid request body fullTextSearch/],
    ];
    for (const [body, message] of cases) {
      expect(() => parseKomgaSeriesSearch(body)).toThrow(BadRequestException);
      expect(() => parseKomgaSeriesSearch(body)).toThrow(message);
    }
  });

  it('bounds nesting depth', () => {
    let condition: unknown = { deleted: { operator: 'isFalse' } };
    for (let depth = 0; depth < 12; depth += 1) condition = { allOf: [condition] };
    expect(() => parseKomgaSeriesSearch({ condition })).toThrow(/nesting is too deep/);
  });
});

describe('parseKomgaBookSearch', () => {
  it('parses book leaves and normalizes ids', () => {
    const parsed = parseKomgaBookSearch({
      condition: {
        anyOf: [
          { seriesId: { operator: 'is', value: '3-s7' } },
          { seriesId: { operator: 'isNot', value: 'garbage' } },
          { libraryId: { operator: 'is', value: 'not-a-number' } },
          { mediaStatus: { operator: 'is', value: 'READY' } },
          { mediaProfile: { operator: 'isNot', value: 'PDF' } },
          { readStatus: { operator: 'isNot', value: 'READ' } },
          { title: { operator: 'doesNotEndWith', value: 'Annual' } },
          { tag: { operator: 'is', value: 'space' } },
          { oneShot: { operator: 'isTrue' } },
          { author: { operator: 'isNot', value: { role: 'penciller' } } },
        ],
      },
    });
    expect(parsed.condition).toEqual({
      kind: 'anyOf',
      conditions: [
        { kind: 'seriesId', match: { operator: 'is', value: { kind: 'series', libraryId: 3, seriesId: 7 } } },
        { kind: 'seriesId', match: { operator: 'isNot', value: null } },
        { kind: 'libraryId', match: { operator: 'is', value: null } },
        { kind: 'mediaStatus', match: { operator: 'is', value: 'READY' } },
        { kind: 'mediaProfile', match: { operator: 'isNot', value: 'PDF' } },
        { kind: 'readStatus', match: { operator: 'isNot', value: 'READ' } },
        { kind: 'title', match: { operator: 'doesNotEndWith', value: 'Annual' } },
        { kind: 'tag', match: { operator: 'is', value: 'space' } },
        { kind: 'oneShot', match: { operator: 'isTrue' } },
        { kind: 'author', match: { operator: 'isNot', value: { name: null, role: 'penciller' } } },
      ],
    });
  });

  it('answers 400 for Komga leaves this server does not support and for series-only leaves', () => {
    expect(() => parseKomgaBookSearch({ condition: { numberSort: { operator: 'is', value: 1 } } })).toThrow(
      /Unsupported search condition: numberSort/,
    );
    expect(() => parseKomgaBookSearch({ condition: { poster: { operator: 'is', value: {} } } })).toThrow(/Unsupported search condition: poster/);
    expect(() => parseKomgaBookSearch({ condition: { readListId: { operator: 'is', value: 'c1' } } })).toThrow(
      /Unsupported search condition: readListId/,
    );
    expect(() => parseKomgaBookSearch({ condition: { genre: { operator: 'is', value: 'Drama' } } })).toThrow(/Unknown search condition: genre/);
    expect(() => parseKomgaBookSearch({ condition: { mediaStatus: { operator: 'is', value: 'BROKEN' } } })).toThrow(BadRequestException);
  });
});

describe('required leaves', () => {
  const scope: KomgaScope = {
    userId: 1,
    isSuperuser: false,
    contentFilters: { includeTagIds: [], includeGenreIds: [], excludeTagIds: [], excludeGenreIds: [] },
    includeNonComicBooks: false,
    groupUnknownSeries: true,
    libraryIds: [1, 2, 3],
  };

  it('narrows library scope using required libraryId conditions', () => {
    const required = parseKomgaSeriesSearch({
      condition: { allOf: [{ libraryId: { operator: 'is', value: '2' } }, { allOf: [{ tag: { operator: 'is', value: 'x' } }] }] },
    }).condition;
    expect(requiredLibraryIds(required)).toEqual([2]);
    expect(restrictScopeToCondition(scope, required).libraryIds).toEqual([2]);

    const optional = parseKomgaSeriesSearch({ condition: { anyOf: [{ libraryId: { operator: 'is', value: '2' } }] } }).condition;
    expect(requiredLibraryIds(optional)).toBeUndefined();
    expect(restrictScopeToCondition(scope, optional)).toBe(scope);

    const excluded = parseKomgaSeriesSearch({ condition: { libraryId: { operator: 'isNot', value: '2' } } }).condition;
    expect(requiredLibraryIds(excluded)).toBeUndefined();

    const contradictory = parseKomgaSeriesSearch({
      condition: { allOf: [{ libraryId: { operator: 'is', value: '2' } }, { libraryId: { operator: 'is', value: '3' } }] },
    }).condition;
    expect(requiredLibraryIds(contradictory)).toEqual([]);
    expect(restrictScopeToCondition(scope, contradictory).libraryIds).toEqual([]);

    const foreign = parseKomgaSeriesSearch({ condition: { libraryId: { operator: 'is', value: '9' } } }).condition;
    expect(restrictScopeToCondition(scope, foreign).libraryIds).toEqual([]);
    expect(restrictScopeToCondition(scope, null)).toBe(scope);
  });

  it('uses a single required seriesId leaf as the book context', () => {
    const one = parseKomgaBookSearch({ condition: { allOf: [{ seriesId: { operator: 'is', value: '2-s9' } }] } }).condition;
    expect(requiredSeriesKey(one)).toEqual({ kind: 'series', libraryId: 2, seriesId: 9 });

    const two = parseKomgaBookSearch({
      condition: { allOf: [{ seriesId: { operator: 'is', value: '2-s9' } }, { seriesId: { operator: 'is', value: '2-u' } }] },
    }).condition;
    expect(requiredSeriesKey(two)).toBeUndefined();

    const optional = parseKomgaBookSearch({ condition: { anyOf: [{ seriesId: { operator: 'is', value: '2-s9' } }] } }).condition;
    expect(requiredSeriesKey(optional)).toBeUndefined();
    expect(requiredSeriesKey(parseKomgaBookSearch({ condition: { seriesId: { operator: 'is', value: 'garbage' } } }).condition)).toBeUndefined();
    expect(requiredSeriesKey(null)).toBeUndefined();
  });
});

describe('parseIsoDurationMs', () => {
  it('reads days, hours, minutes and seconds and rejects other shapes', () => {
    expect(parseIsoDurationMs('P1D')).toBe(86_400_000);
    expect(parseIsoDurationMs('PT1H30M')).toBe(5_400_000);
    expect(parseIsoDurationMs('P2DT12H')).toBe(216_000_000);
    expect(parseIsoDurationMs('PT0.5S')).toBe(0);
    expect(parseIsoDurationMs('P')).toBeNull();
    expect(parseIsoDurationMs('PT')).toBeNull();
    expect(parseIsoDurationMs('P1Y')).toBeNull();
    expect(parseIsoDurationMs('30d')).toBeNull();
  });
});
