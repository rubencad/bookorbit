import { SQL, and, or, sql } from 'drizzle-orm';

import { accentInsensitiveIlike, escapeLikePattern } from '../../common/utils/accent-insensitive-search.utils';
import { normalizeMetadataText } from '../../common/utils/metadata-text-normalize.utils';
import type { KomgaSeriesKey } from './komga-ids';
import type {
  KomgaAuthorMatch,
  KomgaBookCondition,
  KomgaBookLeaf,
  KomgaConditionTree,
  KomgaDateMatch,
  KomgaEquality,
  KomgaNullableEquality,
  KomgaSeriesCondition,
  KomgaSeriesLeaf,
  KomgaStringMatch,
} from './komga-search-condition';
import type { KomgaMediaProfile, KomgaMediaStatusValue, KomgaReadStatus } from './komga.constants';

// Predicates over the `books` row of the query being built; the repository owns the tables.
export interface KomgaBookPredicates {
  library(libraryId: number): SQL;
  series(key: KomgaSeriesKey): SQL;
  oneshot(): SQL;
  title(): SQL;
  releaseDate(): SQL;
  readStatus(statuses: readonly KomgaReadStatus[]): SQL;
  term(kind: 'genre' | 'tag', name: string): SQL;
  anyTerm(kind: 'genre' | 'tag'): SQL;
  metadataText(field: 'publisher' | 'language', value: string): SQL;
  author(match: KomgaAuthorMatch): SQL;
  mediaStatus(status: KomgaMediaStatusValue): SQL;
  mediaProfile(profile: KomgaMediaProfile): SQL;
}

// Predicates over one row of the grouped series source, aliased `series`.
export interface KomgaSeriesPredicates {
  book: KomgaBookPredicates;
  memberExists(predicate: SQL): SQL;
  releaseDate(): SQL;
}

const TRUE = sql`true`;
const FALSE = sql`false`;
const SERIES = {
  libraryId: sql`series.library_id`,
  seriesId: sql`series.series_id`,
  bookId: sql`series.book_id`,
  name: sql`series.name`,
  booksCount: sql`series.books_count`,
  readCount: sql`series.books_read_count`,
  inProgressCount: sql`series.books_in_progress_count`,
  expectedBookCount: sql`series.expected_book_count`,
};

function not(predicate: SQL): SQL {
  return sql`NOT (${predicate})`;
}

function bool(value: boolean): SQL {
  return value ? TRUE : FALSE;
}

function equalityOf<T>(match: KomgaEquality<T>, positive: (value: T) => SQL): SQL {
  const predicate = positive(match.value);
  return match.operator === 'is' ? predicate : not(predicate);
}

function nullableEqualityOf<T>(match: KomgaNullableEquality<T>, positive: (value: T) => SQL, any: () => SQL): SQL {
  switch (match.operator) {
    case 'is':
      return positive(match.value);
    case 'isNot':
      return not(positive(match.value));
    case 'isNull':
      return not(any());
    case 'isNotNull':
      return any();
  }
}

function alwaysNull(match: { operator: string }): SQL {
  return bool(match.operator === 'isNull' || match.operator === 'isNot');
}

export function komgaLikePattern(match: KomgaStringMatch): string {
  const escaped = escapeLikePattern(normalizeMetadataText(match.value) ?? '');
  switch (match.operator) {
    case 'is':
    case 'isNot':
      return escaped;
    case 'contains':
    case 'doesNotContain':
      return `%${escaped}%`;
    case 'beginsWith':
    case 'doesNotBeginWith':
      return `${escaped}%`;
    case 'endsWith':
    case 'doesNotEndWith':
      return `%${escaped}`;
  }
}

export function compileStringMatch(column: SQL, match: KomgaStringMatch): SQL {
  const like = accentInsensitiveIlike(column, komgaLikePattern(match));
  return match.operator === 'isNot' || match.operator.startsWith('doesNot') ? not(like) : like;
}

export function compileDateMatch(column: SQL, match: KomgaDateMatch): SQL {
  switch (match.operator) {
    case 'before':
      return sql`${column} < ${match.date}::date`;
    case 'after':
      return sql`${column} > ${match.date}::date`;
    case 'onOrAfter':
      return sql`${column} >= ${match.date}::date`;
    case 'isNull':
      return sql`${column} IS NULL`;
    case 'isNotNull':
      return sql`${column} IS NOT NULL`;
  }
}

function compileTree<L>(tree: KomgaConditionTree<L>, leaf: (node: L) => SQL): SQL {
  if (isBranch(tree)) {
    const children = tree.conditions.map((child) => compileTree(child, leaf));
    if (children.length === 0) return TRUE;
    return (tree.kind === 'allOf' ? and(...children) : or(...children))!;
  }
  return leaf(tree);
}

function isBranch<L>(tree: KomgaConditionTree<L>): tree is { kind: 'allOf' | 'anyOf'; conditions: KomgaConditionTree<L>[] } {
  return typeof tree === 'object' && tree !== null && 'conditions' in tree;
}

function seriesComplete(): SQL {
  return sql`(${SERIES.expectedBookCount} IS NOT NULL AND ${SERIES.booksCount} >= ${SERIES.expectedBookCount})`;
}

function seriesReadStatus(status: KomgaReadStatus): SQL {
  switch (status) {
    case 'READ':
      return sql`${SERIES.readCount} = ${SERIES.booksCount}`;
    case 'UNREAD':
      return sql`(${SERIES.readCount} = 0 AND ${SERIES.inProgressCount} = 0)`;
    case 'IN_PROGRESS':
      return sql`(${SERIES.readCount} < ${SERIES.booksCount} AND (${SERIES.readCount} > 0 OR ${SERIES.inProgressCount} > 0))`;
  }
}

function compileSeriesLeaf(node: KomgaSeriesLeaf, p: KomgaSeriesPredicates): SQL {
  switch (node.kind) {
    case 'libraryId':
      return equalityOf(node.match, (value) => (value === null ? FALSE : sql`${SERIES.libraryId} = ${value}`));
    case 'collectionId':
      return equalityOf(node.match, () => FALSE);
    case 'deleted':
      return bool(node.match.operator === 'isFalse');
    case 'complete':
      return node.match.operator === 'isTrue' ? seriesComplete() : not(seriesComplete());
    case 'oneShot':
      return node.match.operator === 'isTrue' ? sql`${SERIES.bookId} IS NOT NULL` : sql`${SERIES.bookId} IS NULL`;
    case 'title':
    case 'titleSort':
      return compileStringMatch(SERIES.name, node.match);
    case 'releaseDate':
      return compileDateMatch(p.releaseDate(), node.match);
    case 'tag':
    case 'genre':
      return nullableEqualityOf(
        node.match,
        (value) => p.memberExists(p.book.term(node.kind, value)),
        () => p.memberExists(p.book.anyTerm(node.kind)),
      );
    case 'sharingLabel':
    case 'ageRating':
      return alwaysNull(node.match);
    case 'publisher':
    case 'language':
      return equalityOf(node.match, (value) => p.memberExists(p.book.metadataText(node.kind, value)));
    case 'readStatus':
      return equalityOf(node.match, seriesReadStatus);
    case 'seriesStatus':
      return equalityOf(node.match, (value) => (value === 'ENDED' ? seriesComplete() : value === 'ONGOING' ? not(seriesComplete()) : FALSE));
    case 'author':
      return equalityOf(node.match, (value) => p.memberExists(p.book.author(value)));
  }
}

function compileBookLeaf(node: KomgaBookLeaf, p: KomgaBookPredicates): SQL {
  switch (node.kind) {
    case 'libraryId':
      return equalityOf(node.match, (value) => (value === null ? FALSE : p.library(value)));
    case 'seriesId':
      return equalityOf(node.match, (value) => (value === null ? FALSE : p.series(value)));
    case 'deleted':
      return bool(node.match.operator === 'isFalse');
    case 'oneShot':
      return node.match.operator === 'isTrue' ? p.oneshot() : not(p.oneshot());
    case 'title':
      return compileStringMatch(p.title(), node.match);
    case 'releaseDate':
      return compileDateMatch(p.releaseDate(), node.match);
    case 'tag':
      return nullableEqualityOf(
        node.match,
        (value) => p.term('tag', value),
        () => p.anyTerm('tag'),
      );
    case 'readStatus':
      return equalityOf(node.match, (value) => p.readStatus([value]));
    case 'mediaStatus':
      return equalityOf(node.match, (value) => p.mediaStatus(value));
    case 'mediaProfile':
      return equalityOf(node.match, (value) => p.mediaProfile(value));
    case 'author':
      return equalityOf(node.match, (value) => p.author(value));
  }
}

export function compileKomgaSeriesCondition(condition: KomgaSeriesCondition, predicates: KomgaSeriesPredicates): SQL {
  return compileTree(condition, (node) => compileSeriesLeaf(node, predicates));
}

export function compileKomgaBookCondition(condition: KomgaBookCondition, predicates: KomgaBookPredicates): SQL {
  return compileTree(condition, (node) => compileBookLeaf(node, predicates));
}
