import { Inject, Injectable } from '@nestjs/common';
import { SQL, and, eq, exists, inArray, notExists, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { EBOOK_FORMAT_LIST, type ReadStatus, type ReadStatusSource } from '@bookorbit/types';
import { COMIC_CONTAINER_FORMATS } from '../../common/comic-format-detect';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import {
  authors,
  bookAuthors,
  bookFiles,
  bookGenres,
  bookMetadata,
  bookSeries,
  bookSeriesMemberships,
  bookTags,
  books,
  comicMetadata,
  genres,
  libraries,
  readingProgress,
  tags,
  userBookStatus,
  userLibraryAccess,
} from '../../db/schema';
import { accentInsensitiveIlike, buildSearchPattern } from '../../common/utils/accent-insensitive-search.utils';
import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';
import { seriesIndexOrderBy } from '../../common/utils/series-index-sql.utils';
import type {
  KomgaAuthorRef,
  KomgaBookFileRecord,
  KomgaLibraryRecord,
  KomgaScope,
  KomgaSeriesAggregate,
  KomgaSeriesNumbering,
  KomgaSeriesRecord,
} from './komga-catalog.types';
import { formatSeriesId, type KomgaSeriesKey } from './komga-ids';
import type { KomgaPageRequest } from './komga-page-response';
import { KOMGA_SERIES_TERMS_MAX, KOMGA_UNKNOWN_SERIES_TITLE, type KomgaAuthorRole } from './komga.constants';

type Db = NodePgDatabase<typeof schema>;

export interface KomgaSeriesFilters {
  search?: string;
  statuses?: string[];
  genres?: string[];
  tags?: string[];
  publishers?: string[];
  languages?: string[];
  authors?: string[];
  readStatuses?: string[];
  oneshot?: boolean;
  updatedOnly?: boolean;
}

export interface KomgaOnDeckEntry {
  key: KomgaSeriesKey;
  bookId: number;
}

export interface KomgaBookFilters {
  search?: string;
  mediaStatuses?: string[];
  readStatuses?: string[];
  tags?: string[];
  authors?: string[];
}

export interface KomgaReferentialWindow {
  search?: string;
  limit: number;
  offset: number;
}

export interface KomgaAuthorWindow extends KomgaReferentialWindow {
  role?: string;
}

export interface KomgaReferentialValues {
  values: string[];
  total: number;
}

export interface KomgaReferentialAuthors {
  authors: KomgaAuthorRef[];
  total: number;
}

export interface KomgaBookRow {
  id: number;
  libraryId: number;
  primaryFileId: number | null;
  folderPath: string;
  addedAt: Date;
  updatedAt: Date;
  formatPriority: string[];
  title: string | null;
  description: string | null;
  publishedDate: string | null;
  isbn10: string | null;
  isbn13: string | null;
  metadataUpdatedAt: Date | null;
}

export interface KomgaMembershipRow {
  bookId: number;
  seriesId: number;
  seriesName: string;
  seriesIndex: string | null;
  displayOrder: number;
}

export interface KomgaComicCreditsRow {
  bookId: number;
  pencillers: string[] | null;
  inkers: string[] | null;
  colorists: string[] | null;
  letterers: string[] | null;
  coverArtists: string[] | null;
}

export interface KomgaProgressRow {
  bookFileId: number;
  pageNumber: number | null;
  percentage: number;
  lastReadAt: Date;
  updatedAt: Date;
}

export interface KomgaStatusRow {
  bookId: number;
  status: ReadStatus;
  source: ReadStatusSource;
  finishedAt: Date | null;
  updatedAt: Date;
}

export interface KomgaBookHydration {
  books: KomgaBookRow[];
  files: Map<number, KomgaBookFileRecord[]>;
  authors: Map<number, string[]>;
  tags: Map<number, string[]>;
  credits: Map<number, KomgaComicCreditsRow>;
  memberships: Map<number, KomgaMembershipRow[]>;
  progress: Map<number, KomgaProgressRow>;
  statuses: Map<number, KomgaStatusRow>;
}

type SeriesSourceRow = {
  library_id: number;
  series_id: number | null;
  book_id: number | null;
  name: string;
  books_count: number;
  books_read_count: number;
  books_in_progress_count: number;
  last_read_at: Date | null;
  created_at: Date;
  updated_at: Date;
  expected_book_count: number | null;
};

const READ_STATUS_FILTERS = ['UNREAD', 'IN_PROGRESS', 'READ'] as const;
type ReadStatusFilter = (typeof READ_STATUS_FILTERS)[number];

const NON_COMIC_VISIBLE_FORMATS: readonly string[] = EBOOK_FORMAT_LIST;
const PAGE_LAYOUT_FORMATS: readonly string[] = ['pdf', 'djvu'];
const SERIES_SORT_COLUMNS: Record<string, SQL> = {
  'metadata.titleSort': sql`lower(series.name)`,
  'metadata.title': sql`lower(series.name)`,
  name: sql`lower(series.name)`,
  lastModifiedDate: sql`series.updated_at`,
  createdDate: sql`series.created_at`,
  booksCount: sql`series.books_count`,
  relevance: sql`lower(series.name)`,
  random: sql`lower(series.name)`,
};
export const KOMGA_SERIES_SORT_PROPERTIES = Object.keys(SERIES_SORT_COLUMNS);

const BOOK_SORT_COLUMNS: Record<string, SQL> = {
  'metadata.titleSort': sql`lower(${bookMetadata.title})`,
  'metadata.title': sql`lower(${bookMetadata.title})`,
  name: sql`lower(${bookMetadata.title})`,
  createdDate: sql`${books.addedAt}`,
  lastModifiedDate: sql`${books.updatedAt}`,
  fileLastModified: sql`${books.updatedAt}`,
  'metadata.numberSort': sql`lower(${bookMetadata.title})`,
};
export const KOMGA_BOOK_SORT_PROPERTIES = Object.keys(BOOK_SORT_COLUMNS);
export const KOMGA_SERIES_BOOK_SORT_PROPERTIES = [
  'metadata.numberSort',
  'metadata.titleSort',
  'metadata.title',
  'name',
  'createdDate',
  'lastModifiedDate',
];

const COMIC_CREDIT_COLUMNS: ReadonlyArray<{ column: SQL; role: KomgaAuthorRole }> = [
  { column: sql`${comicMetadata.pencillers}`, role: 'penciller' },
  { column: sql`${comicMetadata.inkers}`, role: 'inker' },
  { column: sql`${comicMetadata.colorists}`, role: 'colorist' },
  { column: sql`${comicMetadata.letterers}`, role: 'letterer' },
  { column: sql`${comicMetadata.coverArtists}`, role: 'cover' },
];

function direction(sortDirection: 'asc' | 'desc'): SQL {
  return sql.raw(sortDirection === 'desc' ? 'DESC' : 'ASC');
}

function joinSql(parts: SQL[], separator: SQL): SQL {
  return sql.join(parts, separator);
}

@Injectable()
export class KomgaCatalogRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async getAccessibleLibraryIds(userId: number, isSuperuser: boolean): Promise<number[]> {
    if (isSuperuser) {
      const rows = await this.db.select({ id: libraries.id }).from(libraries);
      return rows.map((row) => row.id);
    }
    const rows = await this.db.select({ libraryId: userLibraryAccess.libraryId }).from(userLibraryAccess).where(eq(userLibraryAccess.userId, userId));
    return rows.map((row) => row.libraryId);
  }

  async listLibraries(libraryIds: number[]): Promise<KomgaLibraryRecord[]> {
    if (libraryIds.length === 0) return [];
    return this.db
      .select({ id: libraries.id, name: libraries.name, createdAt: libraries.createdAt, updatedAt: libraries.updatedAt })
      .from(libraries)
      .where(inArray(libraries.id, libraryIds))
      .orderBy(libraries.displayOrder, libraries.name);
  }

  async listSeries(scope: KomgaScope, filters: KomgaSeriesFilters, page: KomgaPageRequest): Promise<{ rows: KomgaSeriesRecord[]; total: number }> {
    const source = this.seriesSource(scope, filters);
    if (!source) return { rows: [], total: 0 };

    const orderBy = joinSql(
      [
        ...page.sort.map((sort) => sql`${SERIES_SORT_COLUMNS[sort.property] ?? sql`lower(series.name)`} ${direction(sort.direction)}`),
        sql`series.library_id ASC`,
        sql`series.series_id ASC NULLS LAST`,
        sql`series.book_id ASC NULLS LAST`,
      ],
      sql`, `,
    );

    const listed = filters.updatedOnly ? sql`SELECT * FROM (${source}) AS updated WHERE updated.created_at <> updated.updated_at` : source;
    const [pageResult, countResult] = await Promise.all([
      this.db.execute<SeriesSourceRow>(sql`SELECT * FROM (${listed}) AS series ORDER BY ${orderBy} LIMIT ${page.size} OFFSET ${page.offset}`),
      this.db.execute<{ total: string }>(sql`SELECT count(*)::text AS total FROM (${listed}) AS series`),
    ]);

    return { rows: pageResult.rows.map(toSeriesRecord), total: Number(countResult.rows[0]?.total ?? 0) };
  }

  async listOnDeck(scope: KomgaScope, page: KomgaPageRequest): Promise<{ entries: KomgaOnDeckEntry[]; total: number }> {
    const source = this.seriesSource(scope, {});
    if (!source) return { entries: [], total: 0 };
    const candidates = sql`SELECT * FROM (${source}) AS deck WHERE deck.books_read_count > 0 AND deck.books_in_progress_count = 0 AND deck.books_read_count < deck.books_count`;
    const orderBy = sql`series.last_read_at DESC NULLS LAST, series.updated_at DESC, series.library_id ASC, series.series_id ASC NULLS LAST, series.book_id ASC NULLS LAST`;

    const [pageResult, countResult] = await Promise.all([
      this.db.execute<SeriesSourceRow>(sql`SELECT * FROM (${candidates}) AS series ORDER BY ${orderBy} LIMIT ${page.size} OFFSET ${page.offset}`),
      this.db.execute<{ total: string }>(sql`SELECT count(*)::text AS total FROM (${candidates}) AS series`),
    ]);
    const total = Number(countResult.rows[0]?.total ?? 0);
    const series = pageResult.rows.map(toSeriesRecord);
    if (series.length === 0) return { entries: [], total };

    const members = this.membersCte(
      scope,
      series.map((row) => row.key),
    );
    const { read, inProgress } = this.readStateClauses(scope.userId);
    const nextUnread = await this.db.execute<{ key: string; book_id: number }>(
      sql`WITH members AS (${members})
      SELECT DISTINCT ON (members.key) members.key, members.book_id
      FROM members
      INNER JOIN ${books} ON ${books.id} = members.book_id
      LEFT JOIN ${bookMetadata} ON ${bookMetadata.bookId} = members.book_id
      WHERE NOT ${read} AND NOT ${inProgress}
      ORDER BY members.key, ${joinSql(seriesIndexOrderBy(sql`members.series_index`, 'ASC'), sql`, `)}, lower(${bookMetadata.title}) ASC NULLS LAST, members.book_id ASC`,
    );
    const nextByKey = new Map(nextUnread.rows.map((row) => [row.key, row.book_id]));

    const entries: KomgaOnDeckEntry[] = [];
    for (const row of series) {
      const bookId = nextByKey.get(formatSeriesId(row.key));
      if (bookId !== undefined) entries.push({ key: row.key, bookId });
    }
    return { entries, total };
  }

  async findSeries(scope: KomgaScope, key: KomgaSeriesKey): Promise<KomgaSeriesRecord | null> {
    if (!scope.libraryIds.includes(key.libraryId)) return null;
    const source = this.seriesSource({ ...scope, libraryIds: [key.libraryId] }, {}, key);
    if (!source) return null;
    const result = await this.db.execute<SeriesSourceRow>(sql`SELECT * FROM (${source}) AS series LIMIT 1`);
    const row = result.rows[0];
    return row ? toSeriesRecord(row) : null;
  }

  async aggregateSeries(scope: KomgaScope, keys: KomgaSeriesKey[]): Promise<Map<string, KomgaSeriesAggregate>> {
    const aggregates = new Map<string, KomgaSeriesAggregate>();
    for (const key of keys) {
      aggregates.set(formatSeriesId(key), {
        lowestBookId: null,
        summary: '',
        summaryNumber: '',
        publisher: null,
        language: null,
        releaseDate: null,
        genres: [],
        tags: [],
        authors: [],
      });
    }
    if (keys.length === 0) return aggregates;

    const members = this.membersCte(scope, keys);
    const lowestOrder = sql`ORDER BY members.key, ${joinSql(seriesIndexOrderBy(sql`members.series_index`, 'ASC'), sql`, `)}, lower(${bookMetadata.title}) ASC NULLS LAST, members.book_id ASC`;

    const [lowest, described, stats, terms, credits] = await Promise.all([
      this.db.execute<{ key: string; book_id: number }>(
        sql`WITH members AS (${members}) SELECT DISTINCT ON (members.key) members.key, members.book_id FROM members LEFT JOIN ${bookMetadata} ON ${bookMetadata.bookId} = members.book_id ${lowestOrder}`,
      ),
      this.db.execute<{ key: string; description: string; series_index: string | null }>(
        sql`WITH members AS (${members}) SELECT DISTINCT ON (members.key) members.key, ${bookMetadata.description} AS description, members.series_index FROM members INNER JOIN ${bookMetadata} ON ${bookMetadata.bookId} = members.book_id WHERE ${bookMetadata.description} IS NOT NULL AND ${bookMetadata.description} <> '' ${lowestOrder}`,
      ),
      this.db.execute<{ key: string; release_date: string | null; publisher: string | null; language: string | null }>(
        sql`WITH members AS (${members}) SELECT members.key, min(${bookMetadata.publishedDate})::text AS release_date, mode() WITHIN GROUP (ORDER BY ${bookMetadata.publisher}) AS publisher, mode() WITHIN GROUP (ORDER BY ${bookMetadata.language}) AS language FROM members INNER JOIN ${bookMetadata} ON ${bookMetadata.bookId} = members.book_id GROUP BY members.key`,
      ),
      this.db.execute<{ key: string; kind: 'genre' | 'tag'; name: string }>(
        sql`WITH members AS (${members}), terms AS (
          SELECT members.key, 'genre' AS kind, ${genres.name} AS name FROM members INNER JOIN ${bookGenres} ON ${bookGenres.bookId} = members.book_id INNER JOIN ${genres} ON ${genres.id} = ${bookGenres.genreId}
          UNION
          SELECT members.key, 'tag' AS kind, ${tags.name} AS name FROM members INNER JOIN ${bookTags} ON ${bookTags.bookId} = members.book_id INNER JOIN ${tags} ON ${tags.id} = ${bookTags.tagId}
        ), ranked AS (SELECT key, kind, name, row_number() OVER (PARTITION BY key, kind ORDER BY lower(name), name) AS rn FROM terms)
        SELECT key, kind, name FROM ranked WHERE rn <= ${KOMGA_SERIES_TERMS_MAX} ORDER BY key, kind, rn`,
      ),
      this.db.execute<{ key: string; name: string; role: KomgaAuthorRole }>(
        sql`WITH members AS (${members}), credits AS (${this.creditsUnion()}),
        ranked AS (SELECT key, name, role, row_number() OVER (PARTITION BY key ORDER BY role, lower(name), name) AS rn FROM credits WHERE name IS NOT NULL AND name <> '')
        SELECT key, name, role FROM ranked WHERE rn <= ${KOMGA_SERIES_TERMS_MAX} ORDER BY key, rn`,
      ),
    ]);

    for (const row of lowest.rows) aggregates.get(row.key)!.lowestBookId = row.book_id;
    for (const row of described.rows) {
      const aggregate = aggregates.get(row.key)!;
      aggregate.summary = row.description;
      aggregate.summaryNumber = row.series_index ?? '';
    }
    for (const row of stats.rows) {
      const aggregate = aggregates.get(row.key)!;
      aggregate.releaseDate = row.release_date;
      aggregate.publisher = row.publisher;
      aggregate.language = row.language;
    }
    for (const row of terms.rows) {
      const aggregate = aggregates.get(row.key)!;
      (row.kind === 'genre' ? aggregate.genres : aggregate.tags).push(row.name);
    }
    for (const row of credits.rows) aggregates.get(row.key)!.authors.push({ name: row.name, role: row.role });

    return aggregates;
  }

  async listSeriesBooks(
    scope: KomgaScope,
    key: KomgaSeriesKey,
    filters: KomgaBookFilters,
    page: KomgaPageRequest,
  ): Promise<{ bookIds: number[]; total: number }> {
    if (!scope.libraryIds.includes(key.libraryId)) return { bookIds: [], total: 0 };
    const clauses = [
      ...this.baseClauses({ ...scope, libraryIds: [key.libraryId] }),
      ...this.bookFilterClauses(scope, filters),
      ...this.seriesMemberClauses(key),
    ];
    const where = and(...clauses)!;

    const orderBy: SQL[] = [];
    const sort = page.sort[0];
    if (key.kind === 'series' && (!sort || sort.property === 'metadata.numberSort')) {
      orderBy.push(...seriesIndexOrderBy(bookSeriesMemberships.seriesIndex, sort?.direction === 'desc' ? 'DESC' : 'ASC'));
    } else if (sort && sort.property !== 'metadata.numberSort') {
      orderBy.push(sql`${BOOK_SORT_COLUMNS[sort.property] ?? sql`lower(${bookMetadata.title})`} ${direction(sort.direction)}`);
    }
    orderBy.push(sql`lower(${bookMetadata.title}) ASC NULLS LAST`, sql`${books.id} ASC`);

    const base = this.db.select({ id: books.id }).from(books).leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id));
    const idQuery = (key.kind === 'series' ? base.innerJoin(bookSeriesMemberships, this.membershipJoin(key.seriesId)) : base)
      .where(where)
      .orderBy(...orderBy)
      .limit(page.size)
      .offset(page.offset);
    const countBase = this.db.select({ total: sql<string>`count(*)::text` }).from(books);
    const countQuery = (key.kind === 'series' ? countBase.innerJoin(bookSeriesMemberships, this.membershipJoin(key.seriesId)) : countBase).where(
      where,
    );

    const [idRows, countRows] = await Promise.all([idQuery, countQuery]);
    return { bookIds: idRows.map((row) => row.id), total: Number(countRows[0]?.total ?? 0) };
  }

  async listBooks(scope: KomgaScope, filters: KomgaBookFilters, page: KomgaPageRequest): Promise<{ bookIds: number[]; total: number }> {
    if (scope.libraryIds.length === 0) return { bookIds: [], total: 0 };
    const where = and(...this.baseClauses(scope), ...this.bookFilterClauses(scope, filters))!;
    const orderBy = [
      ...page.sort.map(
        (sort) => sql`${BOOK_SORT_COLUMNS[sort.property] ?? sql`lower(${bookMetadata.title})`} ${direction(sort.direction)} NULLS LAST`,
      ),
      sql`${books.id} ASC`,
    ];

    const [idRows, countRows] = await Promise.all([
      this.db
        .select({ id: books.id })
        .from(books)
        .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(where)
        .orderBy(...orderBy)
        .limit(page.size)
        .offset(page.offset),
      this.db
        .select({ total: sql<string>`count(*)::text` })
        .from(books)
        .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(where),
    ]);
    return { bookIds: idRows.map((row) => row.id), total: Number(countRows[0]?.total ?? 0) };
  }

  async findVisibleBookId(scope: KomgaScope, bookId: number): Promise<number | null> {
    if (scope.libraryIds.length === 0) return null;
    const [row] = await this.db
      .select({ id: books.id })
      .from(books)
      .where(and(eq(books.id, bookId), ...this.baseClauses(scope)))
      .limit(1);
    return row?.id ?? null;
  }

  async hydrateBooks(bookIds: number[], userId: number): Promise<KomgaBookHydration> {
    const hydration: KomgaBookHydration = {
      books: [],
      files: new Map(),
      authors: new Map(),
      tags: new Map(),
      credits: new Map(),
      memberships: new Map(),
      progress: new Map(),
      statuses: new Map(),
    };
    if (bookIds.length === 0) return hydration;

    const [bookRows, fileRows, authorRows, tagRows, creditRows, membershipRows, progressRows, statusRows] = await Promise.all([
      this.db
        .select({
          id: books.id,
          libraryId: books.libraryId,
          primaryFileId: books.primaryFileId,
          folderPath: books.folderPath,
          addedAt: books.addedAt,
          updatedAt: books.updatedAt,
          formatPriority: libraries.formatPriority,
          title: bookMetadata.title,
          description: bookMetadata.description,
          publishedDate: bookMetadata.publishedDate,
          isbn10: bookMetadata.isbn10,
          isbn13: bookMetadata.isbn13,
          metadataUpdatedAt: bookMetadata.updatedAt,
        })
        .from(books)
        .innerJoin(libraries, eq(libraries.id, books.libraryId))
        .leftJoin(bookMetadata, eq(bookMetadata.bookId, books.id))
        .where(inArray(books.id, bookIds)),
      this.db
        .select({
          bookId: bookFiles.bookId,
          id: bookFiles.id,
          format: bookFiles.format,
          absolutePath: bookFiles.absolutePath,
          sizeBytes: bookFiles.sizeBytes,
          mtime: bookFiles.mtime,
          updatedAt: bookFiles.updatedAt,
          fileHash: bookFiles.fileHash,
          pageCount: bookFiles.pageCount,
          pageMediaType: bookFiles.pageMediaType,
        })
        .from(bookFiles)
        .where(and(inArray(bookFiles.bookId, bookIds), eq(bookFiles.role, 'content')))
        .orderBy(bookFiles.sortOrder, bookFiles.id),
      this.db
        .select({ bookId: bookAuthors.bookId, name: authors.name })
        .from(bookAuthors)
        .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
        .where(inArray(bookAuthors.bookId, bookIds))
        .orderBy(bookAuthors.displayOrder),
      this.db
        .select({ bookId: bookTags.bookId, name: tags.name })
        .from(bookTags)
        .innerJoin(tags, eq(tags.id, bookTags.tagId))
        .where(inArray(bookTags.bookId, bookIds))
        .orderBy(tags.name),
      this.db
        .select({
          bookId: comicMetadata.bookId,
          pencillers: comicMetadata.pencillers,
          inkers: comicMetadata.inkers,
          colorists: comicMetadata.colorists,
          letterers: comicMetadata.letterers,
          coverArtists: comicMetadata.coverArtists,
        })
        .from(comicMetadata)
        .where(inArray(comicMetadata.bookId, bookIds)),
      this.db
        .select({
          bookId: bookSeriesMemberships.bookId,
          seriesId: bookSeriesMemberships.seriesId,
          seriesName: bookSeries.name,
          seriesIndex: bookSeriesMemberships.seriesIndex,
          displayOrder: bookSeriesMemberships.displayOrder,
        })
        .from(bookSeriesMemberships)
        .innerJoin(bookSeries, eq(bookSeries.id, bookSeriesMemberships.seriesId))
        .where(inArray(bookSeriesMemberships.bookId, bookIds))
        .orderBy(bookSeriesMemberships.displayOrder),
      this.db
        .select({
          bookFileId: readingProgress.bookFileId,
          pageNumber: readingProgress.pageNumber,
          percentage: readingProgress.percentage,
          lastReadAt: readingProgress.lastReadAt,
          updatedAt: readingProgress.updatedAt,
        })
        .from(readingProgress)
        .innerJoin(bookFiles, eq(bookFiles.id, readingProgress.bookFileId))
        .where(and(inArray(bookFiles.bookId, bookIds), eq(readingProgress.userId, userId))),
      this.db
        .select({
          bookId: userBookStatus.bookId,
          status: userBookStatus.status,
          source: userBookStatus.source,
          finishedAt: userBookStatus.finishedAt,
          updatedAt: userBookStatus.updatedAt,
        })
        .from(userBookStatus)
        .where(and(inArray(userBookStatus.bookId, bookIds), eq(userBookStatus.userId, userId))),
    ]);

    hydration.books = bookRows;
    for (const row of fileRows) {
      if (!row.format) continue;
      const list = hydration.files.get(row.bookId) ?? [];
      list.push({ ...row, format: row.format });
      hydration.files.set(row.bookId, list);
    }
    for (const row of authorRows) {
      const list = hydration.authors.get(row.bookId) ?? [];
      list.push(row.name);
      hydration.authors.set(row.bookId, list);
    }
    for (const row of tagRows) {
      const list = hydration.tags.get(row.bookId) ?? [];
      list.push(row.name);
      hydration.tags.set(row.bookId, list);
    }
    for (const row of creditRows) hydration.credits.set(row.bookId, row);
    for (const row of membershipRows) {
      const list = hydration.memberships.get(row.bookId) ?? [];
      list.push(row);
      hydration.memberships.set(row.bookId, list);
    }
    for (const row of progressRows) hydration.progress.set(row.bookFileId, row);
    for (const row of statusRows) hydration.statuses.set(row.bookId, row);
    return hydration;
  }

  async resolveSeriesNumbering(scope: KomgaScope, keys: KomgaSeriesKey[]): Promise<Map<string, KomgaSeriesNumbering>> {
    const numbering = new Map<string, KomgaSeriesNumbering>();
    for (const key of keys) numbering.set(formatSeriesId(key), { indexedCount: 0, maxIndex: 0, ordinals: new Map() });
    if (keys.length === 0) return numbering;

    const members = this.membersCte(scope, keys);
    const [stats, ordinals] = await Promise.all([
      this.db.execute<{ key: string; indexed_count: string; max_index: string | null }>(
        sql`WITH members AS (${members}) SELECT members.key, count(*) FILTER (WHERE members.series_index IS NOT NULL)::text AS indexed_count, max(floor(members.series_index::numeric))::text AS max_index FROM members GROUP BY members.key`,
      ),
      this.db.execute<{ key: string; book_id: number; ordinal: string }>(
        sql`WITH members AS (${members}) SELECT members.key, members.book_id, row_number() OVER (PARTITION BY members.key ORDER BY lower(${bookMetadata.title}) ASC NULLS LAST, members.book_id ASC)::text AS ordinal FROM members LEFT JOIN ${bookMetadata} ON ${bookMetadata.bookId} = members.book_id WHERE members.series_index IS NULL`,
      ),
    ]);

    for (const row of stats.rows) {
      const entry = numbering.get(row.key)!;
      entry.indexedCount = Number(row.indexed_count);
      entry.maxIndex = row.max_index === null ? 0 : Number(row.max_index);
    }
    for (const row of ordinals.rows) numbering.get(row.key)!.ordinals.set(row.book_id, Number(row.ordinal));
    return numbering;
  }

  async listReferentialValues(
    scope: KomgaScope,
    kind: 'genre' | 'tag' | 'publisher' | 'language',
    window: KomgaReferentialWindow,
  ): Promise<KomgaReferentialValues> {
    if (scope.libraryIds.length === 0) return { values: [], total: 0 };
    const where = and(...this.baseClauses(scope))!;
    const pattern = window.search?.trim() ? buildSearchPattern(window.search.trim()) : null;

    let column: SQL;
    let from: SQL;
    if (kind === 'genre' || kind === 'tag') {
      const [dictionary, link, linkTerm, linkBook] =
        kind === 'genre' ? [genres, bookGenres, bookGenres.genreId, bookGenres.bookId] : [tags, bookTags, bookTags.tagId, bookTags.bookId];
      column = sql`${dictionary.name}`;
      const searchClause = pattern ? sql` AND ${accentInsensitiveIlike(dictionary.name, pattern)}` : sql``;
      from = sql`FROM ${dictionary} INNER JOIN ${link} ON ${linkTerm} = ${dictionary.id} INNER JOIN ${books} ON ${books.id} = ${linkBook} WHERE ${where}${searchClause}`;
    } else {
      const valueColumn = kind === 'publisher' ? bookMetadata.publisher : bookMetadata.language;
      column = sql`${valueColumn}`;
      const searchClause = pattern ? sql` AND ${accentInsensitiveIlike(valueColumn, pattern)}` : sql``;
      from = sql`FROM ${bookMetadata} INNER JOIN ${books} ON ${books.id} = ${bookMetadata.bookId} WHERE ${where} AND ${valueColumn} IS NOT NULL AND ${valueColumn} <> ''${searchClause}`;
    }

    const [rows, count] = await Promise.all([
      this.db.execute<{ name: string }>(
        sql`SELECT DISTINCT ${column} AS name ${from} ORDER BY ${column} LIMIT ${window.limit} OFFSET ${window.offset}`,
      ),
      this.db.execute<{ total: string }>(sql`SELECT count(DISTINCT ${column})::text AS total ${from}`),
    ]);
    return { values: rows.rows.map((row) => row.name), total: Number(count.rows[0]?.total ?? 0) };
  }

  async listReferentialAuthors(scope: KomgaScope, window: KomgaAuthorWindow): Promise<KomgaReferentialAuthors> {
    if (scope.libraryIds.length === 0) return { authors: [], total: 0 };
    const members = this.libraryMembersCte(scope);
    const filters: SQL[] = [sql`credits.name IS NOT NULL`, sql`credits.name <> ''`];
    if (window.search?.trim()) filters.push(accentInsensitiveIlike(sql`credits.name`, buildSearchPattern(window.search.trim())));
    if (window.role?.trim()) filters.push(sql`credits.role = ${window.role.trim().toLowerCase()}`);
    const grouped = sql`SELECT credits.name, credits.role FROM credits WHERE ${joinSql(filters, sql` AND `)} GROUP BY credits.name, credits.role`;

    const [rows, count] = await Promise.all([
      this.db.execute<{ name: string; role: KomgaAuthorRole }>(
        sql`WITH members AS (${members}), credits AS (${this.creditsUnion()})
        SELECT name, role FROM (${grouped}) AS authors ORDER BY lower(name), name, role LIMIT ${window.limit} OFFSET ${window.offset}`,
      ),
      this.db.execute<{ total: string }>(
        sql`WITH members AS (${members}), credits AS (${this.creditsUnion()}) SELECT count(*)::text AS total FROM (${grouped}) AS authors`,
      ),
    ]);
    return { authors: rows.rows.map((row) => ({ name: row.name, role: row.role })), total: Number(count.rows[0]?.total ?? 0) };
  }

  private seriesSource(scope: KomgaScope, filters: KomgaSeriesFilters, key?: KomgaSeriesKey): SQL | null {
    if (scope.libraryIds.length === 0) return null;
    const statuses = new Set((filters.statuses ?? []).map((status) => status.toUpperCase()));
    const wantsEnded = statuses.size === 0 || statuses.has('ENDED');
    const wantsOngoing = statuses.size === 0 || statuses.has('ONGOING');
    if (!wantsEnded && !wantsOngoing) return null;

    const base = this.baseClauses(scope);
    const bookPredicates = this.seriesBookPredicates(filters);
    const searchPattern = filters.search?.trim() ? buildSearchPattern(filters.search.trim()) : null;
    const readStatuses = parseReadStatusFilters(filters.readStatuses);
    if (readStatuses?.length === 0) return null;
    const { read, inProgress } = this.readStateClauses(scope.userId);
    const readCount = sql`count(*) FILTER (WHERE ${read})`;
    const inProgressCount = sql`count(*) FILTER (WHERE ${inProgress})`;
    const lastReadAt = this.lastReadAtSql(scope.userId);
    const groupedCounts = sql`${readCount}::integer AS books_read_count, ${inProgressCount}::integer AS books_in_progress_count, max(${lastReadAt}) AS last_read_at`;
    const groupedReadStatus = readStatuses
      ? joinSql(
          readStatuses.map((status) => {
            if (status === 'READ') return sql`${readCount} = count(*)`;
            if (status === 'UNREAD') return sql`(${readCount} = 0 AND ${inProgressCount} = 0)`;
            return sql`(${readCount} < count(*) AND (${readCount} > 0 OR ${inProgressCount} > 0))`;
          }),
          sql` OR `,
        )
      : null;
    const branches: SQL[] = [];

    const includeNamed = (key === undefined || key.kind === 'series') && filters.oneshot !== true;
    if (includeNamed) {
      const namedClauses: SQL[] = [...base];
      if (key?.kind === 'series') namedClauses.push(eq(bookSeriesMemberships.seriesId, key.seriesId));
      if (searchPattern) namedClauses.push(accentInsensitiveIlike(bookSeries.name, searchPattern));
      const having: SQL[] = bookPredicates.map((predicate) => sql`bool_or(${predicate})`);
      if (!wantsEnded || !wantsOngoing) {
        const ended = sql`(${bookSeries.expectedBookCount} IS NOT NULL AND count(*) >= ${bookSeries.expectedBookCount})`;
        having.push(wantsEnded ? ended : sql`NOT ${ended}`);
      }
      if (groupedReadStatus) having.push(sql`(${groupedReadStatus})`);
      branches.push(sql`SELECT ${books.libraryId} AS library_id, ${bookSeriesMemberships.seriesId} AS series_id, NULL::integer AS book_id, ${bookSeries.name} AS name,
        count(*)::integer AS books_count, ${groupedCounts}, min(${books.addedAt}) AS created_at, max(${books.updatedAt}) AS updated_at, ${bookSeries.expectedBookCount} AS expected_book_count
        FROM ${books}
        INNER JOIN ${bookSeriesMemberships} ON ${bookSeriesMemberships.bookId} = ${books.id}
        INNER JOIN ${bookSeries} ON ${bookSeries.id} = ${bookSeriesMemberships.seriesId}
        WHERE ${and(...namedClauses)}
        GROUP BY ${books.libraryId}, ${bookSeriesMemberships.seriesId}, ${bookSeries.name}, ${bookSeries.expectedBookCount}
        ${having.length > 0 ? sql`HAVING ${joinSql(having, sql` AND `)}` : sql``}`);
    }

    const unmembered = notExists(
      this.db
        .select({ one: sql`1` })
        .from(bookSeriesMemberships)
        .where(sql`${bookSeriesMemberships.bookId} = ${books.id}`),
    );
    const includeUnknown = scope.groupUnknownSeries && (key === undefined || key.kind === 'unknown') && filters.oneshot !== true && wantsOngoing;
    if (includeUnknown && (!searchPattern || matchesTitle(KOMGA_UNKNOWN_SERIES_TITLE, filters.search!))) {
      const having = bookPredicates.map((predicate) => sql`bool_or(${predicate})`);
      if (groupedReadStatus) having.push(sql`(${groupedReadStatus})`);
      branches.push(sql`SELECT ${books.libraryId} AS library_id, NULL::integer AS series_id, NULL::integer AS book_id, ${KOMGA_UNKNOWN_SERIES_TITLE}::varchar AS name,
        count(*)::integer AS books_count, ${groupedCounts}, min(${books.addedAt}) AS created_at, max(${books.updatedAt}) AS updated_at, NULL::integer AS expected_book_count
        FROM ${books}
        WHERE ${and(...base, unmembered)}
        GROUP BY ${books.libraryId}
        ${having.length > 0 ? sql`HAVING ${joinSql(having, sql` AND `)}` : sql``}`);
    }

    const includeOneshots = !scope.groupUnknownSeries && (key === undefined || key.kind === 'oneshot') && filters.oneshot !== false && wantsOngoing;
    if (includeOneshots) {
      const oneshotClauses: SQL[] = [...base, unmembered, ...bookPredicates];
      if (key?.kind === 'oneshot') oneshotClauses.push(eq(books.id, key.bookId));
      if (searchPattern) oneshotClauses.push(accentInsensitiveIlike(bookMetadata.title, searchPattern));
      if (readStatuses) oneshotClauses.push(this.readStatusClause(readStatuses, read, inProgress));
      branches.push(sql`SELECT ${books.libraryId} AS library_id, NULL::integer AS series_id, ${books.id} AS book_id, ${this.bookTitleSql()} AS name,
        1 AS books_count, (CASE WHEN ${read} THEN 1 ELSE 0 END) AS books_read_count, (CASE WHEN ${inProgress} THEN 1 ELSE 0 END) AS books_in_progress_count,
        ${lastReadAt} AS last_read_at, ${books.addedAt} AS created_at, ${books.updatedAt} AS updated_at, NULL::integer AS expected_book_count
        FROM ${books}
        LEFT JOIN ${bookMetadata} ON ${bookMetadata.bookId} = ${books.id}
        WHERE ${and(...oneshotClauses)}`);
    }

    if (branches.length === 0) return null;
    return joinSql(branches, sql` UNION ALL `);
  }

  private lastReadAtSql(userId: number): SQL {
    return sql`(SELECT max(coalesce(${userBookStatus.finishedAt}, ${userBookStatus.updatedAt})) FROM ${userBookStatus} WHERE ${userBookStatus.bookId} = ${books.id} AND ${userBookStatus.userId} = ${userId} AND ${userBookStatus.status} = 'read')`;
  }

  private readStateClauses(userId: number): { read: SQL; inProgress: SQL } {
    const progressFor = (...extra: SQL[]) =>
      exists(
        this.db
          .select({ one: sql`1` })
          .from(readingProgress)
          .innerJoin(bookFiles, eq(bookFiles.id, readingProgress.bookFileId))
          .where(and(sql`${bookFiles.bookId} = ${books.id}`, eq(bookFiles.role, 'content'), eq(readingProgress.userId, userId), ...extra)),
      );
    const statusRead = exists(
      this.db
        .select({ one: sql`1` })
        .from(userBookStatus)
        .where(and(sql`${userBookStatus.bookId} = ${books.id}`, eq(userBookStatus.userId, userId), eq(userBookStatus.status, 'read'))),
    );
    const read = sql`(${statusRead} OR ${progressFor(sql`${readingProgress.percentage} >= 100`)})`;
    return { read, inProgress: sql`(NOT ${read} AND ${progressFor()})` };
  }

  private readStatusClause(statuses: ReadStatusFilter[], read: SQL, inProgress: SQL): SQL {
    if (statuses.length === 0) return sql`false`;
    return sql`(${joinSql(
      statuses.map((status) => {
        if (status === 'READ') return read;
        if (status === 'IN_PROGRESS') return inProgress;
        return sql`(NOT ${read} AND NOT ${inProgress})`;
      }),
      sql` OR `,
    )})`;
  }

  private seriesBookPredicates(filters: KomgaSeriesFilters): SQL[] {
    const predicates: SQL[] = [];
    if (filters.genres?.length) predicates.push(this.termClause('genre', filters.genres));
    if (filters.tags?.length) predicates.push(this.termClause('tag', filters.tags));
    if (filters.publishers?.length) {
      predicates.push(
        exists(
          this.db
            .select({ one: sql`1` })
            .from(bookMetadata)
            .where(and(sql`${bookMetadata.bookId} = ${books.id}`, inArray(bookMetadata.publisher, filters.publishers))),
        ),
      );
    }
    if (filters.languages?.length) {
      predicates.push(
        exists(
          this.db
            .select({ one: sql`1` })
            .from(bookMetadata)
            .where(and(sql`${bookMetadata.bookId} = ${books.id}`, inArray(bookMetadata.language, filters.languages))),
        ),
      );
    }
    if (filters.authors?.length) predicates.push(this.authorClause(filters.authors));
    return predicates;
  }

  private bookFilterClauses(scope: KomgaScope, filters: KomgaBookFilters): SQL[] {
    const clauses: SQL[] = [];
    if (filters.tags?.length) clauses.push(this.termClause('tag', filters.tags));
    if (filters.authors?.length) clauses.push(this.authorClause(filters.authors));
    if (filters.search?.trim()) {
      const pattern = buildSearchPattern(filters.search.trim());
      clauses.push(
        sql`(${accentInsensitiveIlike(bookMetadata.title, pattern)} OR ${exists(
          this.db
            .select({ one: sql`1` })
            .from(bookAuthors)
            .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
            .where(and(sql`${bookAuthors.bookId} = ${books.id}`, accentInsensitiveIlike(authors.name, pattern))),
        )})`,
      );
    }
    const mediaClause = this.mediaStatusClause(scope, filters.mediaStatuses);
    if (mediaClause) clauses.push(mediaClause);
    const readStatuses = parseReadStatusFilters(filters.readStatuses);
    if (readStatuses) {
      const { read, inProgress } = this.readStateClauses(scope.userId);
      clauses.push(this.readStatusClause(readStatuses, read, inProgress));
    }
    return clauses;
  }

  private mediaStatusClause(scope: KomgaScope, statuses: string[] | undefined): SQL | null {
    if (!statuses?.length) return null;
    const wanted = new Set(statuses.map((status) => status.toUpperCase()));
    const ready = wanted.has('READY');
    const unsupported = wanted.has('UNSUPPORTED');
    if (ready && unsupported) return null;
    const pageLayoutPrimary = exists(
      this.db
        .select({ one: sql`1` })
        .from(bookFiles)
        .where(and(sql`${bookFiles.id} = ${books.primaryFileId}`, inArray(bookFiles.format, [...PAGE_LAYOUT_FORMATS]))),
    );
    const streamable = sql`(${this.comicFileClause()} OR NOT ${pageLayoutPrimary})`;
    if (ready) return streamable;
    if (unsupported && scope.includeNonComicBooks) return sql`NOT ${streamable}`;
    return sql`false`;
  }

  private baseClauses(scope: KomgaScope): SQL[] {
    const clauses: SQL[] = [inArray(books.libraryId, scope.libraryIds), eq(books.status, 'present'), this.eligibleClause(scope.includeNonComicBooks)];
    if (!scope.isSuperuser) clauses.push(...buildContentFilterClauses(scope.contentFilters, this.db));
    return clauses;
  }

  private eligibleClause(includeNonComicBooks: boolean): SQL {
    const comic = this.comicFileClause();
    if (!includeNonComicBooks) return comic;
    const nonComicPrimary = exists(
      this.db
        .select({ one: sql`1` })
        .from(bookFiles)
        .where(and(sql`${bookFiles.id} = ${books.primaryFileId}`, inArray(bookFiles.format, [...NON_COMIC_VISIBLE_FORMATS]))),
    );
    return sql`(${comic} OR ${nonComicPrimary})`;
  }

  private comicFileClause(): SQL {
    return exists(
      this.db
        .select({ one: sql`1` })
        .from(bookFiles)
        .where(and(sql`${bookFiles.bookId} = ${books.id}`, eq(bookFiles.role, 'content'), inArray(bookFiles.format, [...COMIC_CONTAINER_FORMATS]))),
    );
  }

  private seriesMemberClauses(key: KomgaSeriesKey): SQL[] {
    switch (key.kind) {
      case 'series':
        return [];
      case 'unknown':
        return [
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(bookSeriesMemberships)
              .where(sql`${bookSeriesMemberships.bookId} = ${books.id}`),
          ),
        ];
      case 'oneshot':
        return [
          eq(books.id, key.bookId),
          notExists(
            this.db
              .select({ one: sql`1` })
              .from(bookSeriesMemberships)
              .where(sql`${bookSeriesMemberships.bookId} = ${books.id}`),
          ),
        ];
    }
  }

  private membershipJoin(seriesId: number): SQL {
    return and(eq(bookSeriesMemberships.bookId, books.id), eq(bookSeriesMemberships.seriesId, seriesId))!;
  }

  private termClause(kind: 'genre' | 'tag', names: string[]): SQL {
    const lowered = names.map((name) => name.toLowerCase());
    if (kind === 'genre') {
      return exists(
        this.db
          .select({ one: sql`1` })
          .from(bookGenres)
          .innerJoin(genres, eq(genres.id, bookGenres.genreId))
          .where(and(sql`${bookGenres.bookId} = ${books.id}`, inArray(sql`lower(${genres.name})`, lowered))),
      );
    }
    return exists(
      this.db
        .select({ one: sql`1` })
        .from(bookTags)
        .innerJoin(tags, eq(tags.id, bookTags.tagId))
        .where(and(sql`${bookTags.bookId} = ${books.id}`, inArray(sql`lower(${tags.name})`, lowered))),
    );
  }

  private authorClause(values: string[]): SQL {
    const names = values.map((value) => value.split(',')[0]?.trim().toLowerCase()).filter((name): name is string => Boolean(name));
    if (names.length === 0) return sql`true`;
    const writers = exists(
      this.db
        .select({ one: sql`1` })
        .from(bookAuthors)
        .innerJoin(authors, eq(authors.id, bookAuthors.authorId))
        .where(and(sql`${bookAuthors.bookId} = ${books.id}`, inArray(sql`lower(${authors.name})`, names))),
    );
    const credits = COMIC_CREDIT_COLUMNS.map(
      ({ column }) => sql`EXISTS (SELECT 1 FROM unnest(${column}) AS credit(name) WHERE lower(credit.name) IN ${names})`,
    );
    return sql`(${writers} OR EXISTS (SELECT 1 FROM ${comicMetadata} WHERE ${comicMetadata.bookId} = ${books.id} AND (${joinSql(credits, sql` OR `)})))`;
  }

  private bookTitleSql(): SQL {
    return sql`coalesce(${bookMetadata.title}, regexp_replace(${books.folderPath}, '^.*/', ''))`;
  }

  private creditsUnion(): SQL {
    const writers = sql`SELECT members.key, ${authors.name} AS name, 'writer'::text AS role FROM members INNER JOIN ${bookAuthors} ON ${bookAuthors.bookId} = members.book_id INNER JOIN ${authors} ON ${authors.id} = ${bookAuthors.authorId}`;
    const credits = COMIC_CREDIT_COLUMNS.map(
      ({ column, role }) =>
        sql`SELECT members.key, unnest(${column}) AS name, ${role}::text AS role FROM members INNER JOIN ${comicMetadata} ON ${comicMetadata.bookId} = members.book_id`,
    );
    return joinSql([writers, ...credits], sql` UNION `);
  }

  private membersCte(scope: KomgaScope, keys: KomgaSeriesKey[]): SQL {
    const base = this.baseClauses(scope);
    const branches: SQL[] = [];

    const named = keys.filter((key): key is Extract<KomgaSeriesKey, { kind: 'series' }> => key.kind === 'series');
    if (named.length > 0) {
      const pairs = joinSql(
        named.map((key) => sql`(${key.libraryId}, ${key.seriesId})`),
        sql`, `,
      );
      branches.push(sql`SELECT ${books.libraryId}::text || '-s' || ${bookSeriesMemberships.seriesId}::text AS key, ${books.id} AS book_id, ${bookSeriesMemberships.seriesIndex} AS series_index
        FROM ${books} INNER JOIN ${bookSeriesMemberships} ON ${bookSeriesMemberships.bookId} = ${books.id}
        WHERE ${and(...base)} AND (${books.libraryId}, ${bookSeriesMemberships.seriesId}) IN (${pairs})`);
    }

    const unmembered = notExists(
      this.db
        .select({ one: sql`1` })
        .from(bookSeriesMemberships)
        .where(sql`${bookSeriesMemberships.bookId} = ${books.id}`),
    );
    const unknownLibraries = keys.filter((key) => key.kind === 'unknown').map((key) => key.libraryId);
    if (unknownLibraries.length > 0) {
      branches.push(sql`SELECT ${books.libraryId}::text || '-u' AS key, ${books.id} AS book_id, NULL::varchar AS series_index
        FROM ${books} WHERE ${and(...base, unmembered, inArray(books.libraryId, unknownLibraries))}`);
    }

    const oneshotBookIds = keys.filter((key): key is Extract<KomgaSeriesKey, { kind: 'oneshot' }> => key.kind === 'oneshot').map((key) => key.bookId);
    if (oneshotBookIds.length > 0) {
      branches.push(sql`SELECT ${books.libraryId}::text || '-b' || ${books.id}::text AS key, ${books.id} AS book_id, NULL::varchar AS series_index
        FROM ${books} WHERE ${and(...base, unmembered, inArray(books.id, oneshotBookIds))}`);
    }

    return joinSql(branches, sql` UNION ALL `);
  }

  private libraryMembersCte(scope: KomgaScope): SQL {
    return sql`SELECT ${books.libraryId}::text AS key, ${books.id} AS book_id, NULL::varchar AS series_index FROM ${books} WHERE ${and(...this.baseClauses(scope))}`;
  }
}

function toSeriesRecord(row: SeriesSourceRow): KomgaSeriesRecord {
  const key: KomgaSeriesKey =
    row.series_id !== null
      ? { kind: 'series', libraryId: row.library_id, seriesId: row.series_id }
      : row.book_id !== null
        ? { kind: 'oneshot', libraryId: row.library_id, bookId: row.book_id }
        : { kind: 'unknown', libraryId: row.library_id };
  return {
    key,
    name: row.name,
    booksCount: Number(row.books_count),
    booksReadCount: Number(row.books_read_count),
    booksInProgressCount: Number(row.books_in_progress_count),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    expectedBookCount: row.expected_book_count === null ? null : Number(row.expected_book_count),
  };
}

function matchesTitle(title: string, search: string): boolean {
  return title.toLowerCase().includes(search.trim().toLowerCase());
}

function parseReadStatusFilters(values: string[] | undefined): ReadStatusFilter[] | undefined {
  if (!values?.length) return undefined;
  const wanted = new Set(values.map((value) => value.trim().toUpperCase()));
  return READ_STATUS_FILTERS.filter((status) => wanted.has(status));
}
