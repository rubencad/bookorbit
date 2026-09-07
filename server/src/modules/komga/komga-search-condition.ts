import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

import type { KomgaScope } from './komga-catalog.types';
import { parseNumericId, parseSeriesId, type KomgaSeriesKey } from './komga-ids';
import { KOMGA_MEDIA_PROFILES, KOMGA_MEDIA_STATUSES, KOMGA_READ_STATUSES, KOMGA_SERIES_STATUSES } from './komga.constants';
import type { KomgaMediaProfile, KomgaMediaStatusValue, KomgaReadStatus, KomgaSeriesStatus } from './komga.constants';

export type KomgaEqualityOperator = 'is' | 'isNot';
export interface KomgaEquality<T> {
  operator: KomgaEqualityOperator;
  value: T;
}
export type KomgaNullableEquality<T> = KomgaEquality<T> | { operator: 'isNull' | 'isNotNull' };
export interface KomgaBooleanMatch {
  operator: 'isTrue' | 'isFalse';
}
export type KomgaStringOperator = 'is' | 'isNot' | 'contains' | 'doesNotContain' | 'beginsWith' | 'doesNotBeginWith' | 'endsWith' | 'doesNotEndWith';
export interface KomgaStringMatch {
  operator: KomgaStringOperator;
  value: string;
}
export type KomgaDateMatch = { operator: 'before' | 'after' | 'onOrAfter'; date: string } | { operator: 'isNull' | 'isNotNull' };
export type KomgaNumericMatch = { operator: 'is' | 'isNot' | 'greaterThan' | 'lessThan'; value: number } | { operator: 'isNull' | 'isNotNull' };
export interface KomgaAuthorMatch {
  name: string | null;
  role: string | null;
}

export type KomgaConditionTree<L> = L | { kind: 'allOf' | 'anyOf'; conditions: KomgaConditionTree<L>[] };

type KomgaSharedLeaf =
  | { kind: 'libraryId'; match: KomgaEquality<number | null> }
  | { kind: 'deleted' | 'oneShot'; match: KomgaBooleanMatch }
  | { kind: 'title'; match: KomgaStringMatch }
  | { kind: 'releaseDate'; match: KomgaDateMatch }
  | { kind: 'tag'; match: KomgaNullableEquality<string> }
  | { kind: 'readStatus'; match: KomgaEquality<KomgaReadStatus> }
  | { kind: 'author'; match: KomgaEquality<KomgaAuthorMatch> };

export type KomgaSeriesLeaf =
  | KomgaSharedLeaf
  | { kind: 'collectionId'; match: KomgaEquality<string> }
  | { kind: 'complete'; match: KomgaBooleanMatch }
  | { kind: 'titleSort'; match: KomgaStringMatch }
  | { kind: 'genre'; match: KomgaNullableEquality<string> }
  | { kind: 'sharingLabel'; match: KomgaNullableEquality<string> }
  | { kind: 'publisher' | 'language'; match: KomgaEquality<string> }
  | { kind: 'ageRating'; match: KomgaNumericMatch }
  | { kind: 'seriesStatus'; match: KomgaEquality<KomgaSeriesStatus> };

export type KomgaBookLeaf =
  | KomgaSharedLeaf
  | { kind: 'seriesId'; match: KomgaEquality<KomgaSeriesKey | null> }
  | { kind: 'mediaStatus'; match: KomgaEquality<KomgaMediaStatusValue> }
  | { kind: 'mediaProfile'; match: KomgaEquality<KomgaMediaProfile> };

export type KomgaSeriesCondition = KomgaConditionTree<KomgaSeriesLeaf>;
export type KomgaBookCondition = KomgaConditionTree<KomgaBookLeaf>;

export interface KomgaSeriesSearch {
  condition: KomgaSeriesCondition | null;
  fullTextSearch: string | undefined;
}

export interface KomgaBookSearch {
  condition: KomgaBookCondition | null;
  fullTextSearch: string | undefined;
}

const MAX_DEPTH = 10;
const MAX_LEAVES = 200;
const MAX_BRANCH = 100;

// Komelia's kotlinx.serialization client emits a "type" class discriminator next to the condition key; Komga's Jackson deduction ignores unknown fields.
const CLASS_DISCRIMINATOR = 'type';

const searchBodySchema = z.object({
  condition: z.unknown().optional().nullable(),
  fullTextSearch: z.string().max(500).optional().nullable(),
});

const text = z.string().max(500);
const equality = <T extends z.ZodType>(value: T) => z.object({ operator: z.enum(['is', 'isNot']), value });
const nullableEquality = <T extends z.ZodType>(value: T) =>
  z.union([z.object({ operator: z.enum(['is', 'isNot']), value }), z.object({ operator: z.enum(['isNull', 'isNotNull']) })]);
const booleanMatch = z.object({ operator: z.enum(['isTrue', 'isFalse']) });
const stringMatch = z.object({
  operator: z.enum(['is', 'isNot', 'contains', 'doesNotContain', 'beginsWith', 'doesNotBeginWith', 'endsWith', 'doesNotEndWith']),
  value: text,
});
const dateMatch = z.union([
  z.object({ operator: z.enum(['before', 'after']), dateTime: z.string().max(64) }),
  z.object({ operator: z.enum(['isInTheLast', 'isNotInTheLast']), duration: z.string().max(64) }),
  z.object({ operator: z.enum(['isNull', 'isNotNull']) }),
]);
const numericMatch = z.union([
  z.object({ operator: z.enum(['is', 'isNot', 'greaterThan', 'lessThan']), value: z.number() }),
  z.object({ operator: z.enum(['isNull', 'isNotNull']) }),
]);
const authorMatch = equality(z.object({ name: text.optional().nullable(), role: z.string().max(100).optional().nullable() }));

const DURATION_PATTERN = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)(?:\.\d+)?S)?)?$/;

export function parseIsoDurationMs(value: string): number | null {
  const match = DURATION_PATTERN.exec(value.trim());
  if (!match || value.trim() === 'P' || value.trim() === 'PT') return null;
  const [, days = '0', hours = '0', minutes = '0', seconds = '0'] = match;
  return ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60_000 + Number(seconds) * 1000;
}

function toDateOnly(value: string, path: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestException(`Invalid search condition at ${path}: dateTime is not a date`);
  return parsed.toISOString().slice(0, 10);
}

function toDateMatch(raw: z.infer<typeof dateMatch>, path: string, now: () => Date): KomgaDateMatch {
  switch (raw.operator) {
    case 'before':
    case 'after':
      return { operator: raw.operator, date: toDateOnly(raw.dateTime, path) };
    case 'isInTheLast':
    case 'isNotInTheLast': {
      const durationMs = parseIsoDurationMs(raw.duration);
      if (durationMs === null) throw new BadRequestException(`Invalid search condition at ${path}: duration must be an ISO 8601 duration`);
      const threshold = new Date(now().getTime() - durationMs).toISOString().slice(0, 10);
      return raw.operator === 'isInTheLast' ? { operator: 'onOrAfter', date: threshold } : { operator: 'before', date: threshold };
    }
    default:
      return { operator: raw.operator };
  }
}

function toAuthorMatch(raw: z.infer<typeof authorMatch>): KomgaEquality<KomgaAuthorMatch> {
  const name = raw.value.name?.trim() || null;
  const role = raw.value.role?.trim().toLowerCase() || null;
  return { operator: raw.operator, value: { name, role } };
}

type LeafParser<C> = (raw: unknown, path: string, now: () => Date) => C;

function leaf<S extends z.ZodType, C>(schema: S, build: (parsed: z.infer<S>, path: string, now: () => Date) => C): LeafParser<C> {
  return (raw, path, now) => {
    const result = schema.safeParse(raw);
    if (!result.success) {
      const issue = result.error.issues[0];
      const where = issue?.path.length ? `${path}.${issue.path.join('.')}` : path;
      throw new BadRequestException(`Invalid search condition at ${where}: ${issue?.message ?? 'invalid operator'}`);
    }
    return build(result.data, path, now);
  };
}

const sharedLeaves: Record<string, LeafParser<KomgaSharedLeaf>> = {
  libraryId: leaf(equality(text), ({ operator, value }) => ({ kind: 'libraryId', match: { operator, value: parseNumericId(value) } })),
  deleted: leaf(booleanMatch, (match) => ({ kind: 'deleted', match })),
  oneShot: leaf(booleanMatch, (match) => ({ kind: 'oneShot', match })),
  title: leaf(stringMatch, (match) => ({ kind: 'title', match })),
  releaseDate: leaf(dateMatch, (raw, path, now) => ({ kind: 'releaseDate', match: toDateMatch(raw, path, now) })),
  tag: leaf(nullableEquality(text), (match) => ({ kind: 'tag', match })),
  readStatus: leaf(equality(z.enum(KOMGA_READ_STATUSES)), (match) => ({ kind: 'readStatus', match })),
  author: leaf(authorMatch, (raw) => ({ kind: 'author', match: toAuthorMatch(raw) })),
};

const seriesLeaves: Record<string, LeafParser<KomgaSeriesLeaf>> = {
  ...sharedLeaves,
  collectionId: leaf(equality(text), (match) => ({ kind: 'collectionId', match })),
  complete: leaf(booleanMatch, (match) => ({ kind: 'complete', match })),
  titleSort: leaf(stringMatch, (match) => ({ kind: 'titleSort', match })),
  genre: leaf(nullableEquality(text), (match) => ({ kind: 'genre', match })),
  sharingLabel: leaf(nullableEquality(text), (match) => ({ kind: 'sharingLabel', match })),
  publisher: leaf(equality(text), (match) => ({ kind: 'publisher', match })),
  language: leaf(equality(text), (match) => ({ kind: 'language', match })),
  ageRating: leaf(numericMatch, (match) => ({ kind: 'ageRating', match })),
  seriesStatus: leaf(equality(z.enum(KOMGA_SERIES_STATUSES)), (match) => ({ kind: 'seriesStatus', match })),
};

const bookLeaves: Record<string, LeafParser<KomgaBookLeaf>> = {
  ...sharedLeaves,
  seriesId: leaf(equality(text), ({ operator, value }) => ({ kind: 'seriesId', match: { operator, value: parseSeriesId(value) } })),
  mediaStatus: leaf(equality(z.enum(KOMGA_MEDIA_STATUSES)), (match) => ({ kind: 'mediaStatus', match })),
  mediaProfile: leaf(equality(z.enum(KOMGA_MEDIA_PROFILES)), (match) => ({ kind: 'mediaProfile', match })),
};

const NO_UNSUPPORTED_LEAVES: ReadonlySet<string> = new Set<string>();
const UNSUPPORTED_BOOK_LEAVES: ReadonlySet<string> = new Set(['numberSort', 'poster', 'readListId']);

class ConditionParser<L extends { kind: string }> {
  private leaves = 0;

  constructor(
    private readonly leafParsers: Record<string, LeafParser<L>>,
    private readonly unsupported: ReadonlySet<string>,
    private readonly now: () => Date,
  ) {}

  parse(raw: unknown, path: string, depth: number): KomgaConditionTree<L> {
    if (depth > MAX_DEPTH) throw new BadRequestException(`Invalid search condition at ${path}: nesting is too deep`);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new BadRequestException(`Invalid search condition at ${path}: expected an object with one condition`);
    }
    const keys = Object.keys(raw).filter((key) => key !== CLASS_DISCRIMINATOR);
    if (keys.length !== 1) throw new BadRequestException(`Invalid search condition at ${path}: expected exactly one condition, got ${keys.length}`);
    const [key] = keys;
    const value = (raw as Record<string, unknown>)[key];

    if (key === 'allOf' || key === 'anyOf') {
      if (!Array.isArray(value)) throw new BadRequestException(`Invalid search condition at ${path}.${key}: expected an array`);
      if (value.length > MAX_BRANCH) throw new BadRequestException(`Invalid search condition at ${path}.${key}: too many conditions`);
      const conditions = value.map((child, index) => this.parse(child, `${path}.${key}.${index}`, depth + 1));
      return { kind: key, conditions };
    }

    if (this.unsupported.has(key)) throw new BadRequestException(`Unsupported search condition: ${key}`);
    const parser = this.leafParsers[key];
    if (!parser) throw new BadRequestException(`Unknown search condition: ${key}`);
    this.leaves += 1;
    if (this.leaves > MAX_LEAVES) throw new BadRequestException('Search condition has too many leaves');
    return parser(value, `${path}.${key}`, this.now);
  }
}

function parseSearchBody(body: unknown): z.infer<typeof searchBodySchema> {
  const result = searchBodySchema.safeParse(body ?? {});
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const field = issue?.path.join('.') || 'body';
  throw new BadRequestException(`Invalid request body ${field}: ${issue?.message ?? 'invalid value'}`);
}

function normalizeFullText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function parseKomgaSeriesSearch(body: unknown, now: () => Date = () => new Date()): KomgaSeriesSearch {
  const parsed = parseSearchBody(body);
  const condition =
    parsed.condition === undefined || parsed.condition === null
      ? null
      : new ConditionParser(seriesLeaves, NO_UNSUPPORTED_LEAVES, now).parse(parsed.condition, 'condition', 0);
  return { condition, fullTextSearch: normalizeFullText(parsed.fullTextSearch) };
}

export function parseKomgaBookSearch(body: unknown, now: () => Date = () => new Date()): KomgaBookSearch {
  const parsed = parseSearchBody(body);
  const condition =
    parsed.condition === undefined || parsed.condition === null
      ? null
      : new ConditionParser(bookLeaves, UNSUPPORTED_BOOK_LEAVES, now).parse(parsed.condition, 'condition', 0);
  return { condition, fullTextSearch: normalizeFullText(parsed.fullTextSearch) };
}

type AnyCondition = KomgaSeriesCondition | KomgaBookCondition;
type AnyLeaf = KomgaSeriesLeaf | KomgaBookLeaf;

// A condition under anyOf may not match every result, so don't use it to narrow the scope or choose the series context.
function requiredLeaves(condition: AnyCondition | null, kind: AnyLeaf['kind']): AnyLeaf[] {
  if (!condition) return [];
  if (condition.kind === 'allOf') return (condition.conditions as AnyCondition[]).flatMap((child) => requiredLeaves(child, kind));
  if (condition.kind === 'anyOf') return [];
  return condition.kind === kind ? [condition] : [];
}

export function requiredLibraryIds(condition: AnyCondition | null): number[] | undefined {
  const leaves = requiredLeaves(condition, 'libraryId').filter(
    (leaf): leaf is Extract<AnyLeaf, { kind: 'libraryId' }> => leaf.kind === 'libraryId' && leaf.match.operator === 'is',
  );
  if (leaves.length === 0) return undefined;
  const ids = new Set(leaves.map((leaf) => leaf.match.value));
  if (ids.size !== 1) return [];
  const [id] = ids;
  return id === null ? [] : [id];
}

export function requiredSeriesKey(condition: KomgaBookCondition | null): KomgaSeriesKey | undefined {
  const leaves = requiredLeaves(condition, 'seriesId').filter(
    (leaf): leaf is Extract<KomgaBookLeaf, { kind: 'seriesId' }> => leaf.kind === 'seriesId' && leaf.match.operator === 'is',
  );
  if (leaves.length !== 1) return undefined;
  return leaves[0].match.value ?? undefined;
}

export function restrictScopeToCondition(scope: KomgaScope, condition: AnyCondition | null): KomgaScope {
  const required = requiredLibraryIds(condition);
  if (required === undefined) return scope;
  return { ...scope, libraryIds: scope.libraryIds.filter((libraryId) => required.includes(libraryId)) };
}
