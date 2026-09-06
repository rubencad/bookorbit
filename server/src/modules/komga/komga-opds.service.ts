import { Injectable } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import type { KomgaRequestAccount } from './komga-auth.guard';
import { KomgaBookService } from './komga-book.service';
import { formatSeriesId } from './komga-ids';
import { KomgaLibraryService } from './komga-library.service';
import {
  KOMGA_OPDS_BASE,
  komgaOpdsBookEntry,
  komgaOpdsFeed,
  komgaOpdsLibraryEntry,
  komgaOpdsNavEntry,
  komgaOpdsSearchLink,
  komgaOpdsSeriesEntry,
} from './komga-opds.feed';
import type { SeriesBooksQuery, SeriesListQuery } from './komga-query';
import { KomgaSeriesService } from './komga-series.service';

export interface KomgaOpdsQuery {
  page?: number;
  size?: number;
  search?: string;
}

function selfPath(path: string, query: KomgaOpdsQuery): string {
  const params = new URLSearchParams();
  if (query.search) params.set('search', query.search);
  if (query.size !== undefined) params.set('size', String(query.size));
  params.set('page', String(query.page ?? 0));
  return `${KOMGA_OPDS_BASE}${path}?${params.toString()}`;
}

@Injectable()
export class KomgaOpdsService {
  constructor(
    private readonly libraryService: KomgaLibraryService,
    private readonly seriesService: KomgaSeriesService,
    private readonly bookService: KomgaBookService,
  ) {}

  catalog(): string {
    const now = new Date();
    return komgaOpdsFeed({
      kind: 'navigation',
      id: 'root',
      title: 'BookOrbit',
      selfPath: `${KOMGA_OPDS_BASE}/catalog`,
      extraLinks: [komgaOpdsSearchLink()],
      entries: [
        komgaOpdsNavEntry('allSeries', 'All series', `${KOMGA_OPDS_BASE}/series`, now, 'Browse by series'),
        komgaOpdsNavEntry('latestSeries', 'Latest series', `${KOMGA_OPDS_BASE}/series/latest`, now, 'Recently updated series'),
        komgaOpdsNavEntry('latestBooks', 'Latest books', `${KOMGA_OPDS_BASE}/books/latest`, now, 'Recently added books'),
        komgaOpdsNavEntry('allLibraries', 'All libraries', `${KOMGA_OPDS_BASE}/libraries`, now, 'Browse by library'),
      ],
    });
  }

  async libraries(user: RequestUser): Promise<string> {
    const libraries = await this.libraryService.listLibraries(user);
    return komgaOpdsFeed({
      kind: 'navigation',
      id: 'allLibraries',
      title: 'All libraries',
      selfPath: `${KOMGA_OPDS_BASE}/libraries`,
      entries: libraries.map(komgaOpdsLibraryEntry),
    });
  }

  async series(user: RequestUser, account: KomgaRequestAccount, query: KomgaOpdsQuery): Promise<string> {
    return this.seriesFeed(user, account, query, {
      id: query.search ? `search:${query.search}` : 'allSeries',
      title: query.search ? `Search: ${query.search}` : 'All series',
      path: '/series',
      listQuery: { search: query.search },
    });
  }

  async latestSeries(user: RequestUser, account: KomgaRequestAccount, query: KomgaOpdsQuery): Promise<string> {
    return this.seriesFeed(user, account, query, {
      id: 'latestSeries',
      title: 'Latest series',
      path: '/series/latest',
      listQuery: { sort: ['lastModifiedDate,desc'] },
    });
  }

  async librarySeries(user: RequestUser, account: KomgaRequestAccount, libraryId: number, query: KomgaOpdsQuery): Promise<string> {
    const library = await this.libraryService.getLibrary(user, libraryId);
    return this.seriesFeed(user, account, query, {
      id: String(library.id),
      title: library.name,
      path: `/libraries/${library.id}`,
      listQuery: { library_id: [library.id] },
    });
  }

  async seriesBooks(user: RequestUser, account: KomgaRequestAccount, seriesId: string, query: KomgaOpdsQuery): Promise<string> {
    const booksQuery = { page: query.page, size: query.size } as SeriesBooksQuery;
    const { records, series, page, total } = await this.seriesService.listBookRecords(user, account, seriesId, booksQuery);
    return komgaOpdsFeed({
      kind: 'acquisition',
      id: series ? formatSeriesId(series.key) : seriesId,
      title: series?.name ?? 'Series',
      selfPath: selfPath(`/series/${encodeURIComponent(seriesId)}`, query),
      updated: series?.updatedAt,
      entries: records.map((record) => komgaOpdsBookEntry(record)),
      paging: { page, total },
    });
  }

  async latestBooks(user: RequestUser, account: KomgaRequestAccount, query: KomgaOpdsQuery): Promise<string> {
    const { records, page, total } = await this.bookService.listRecords(user, account, {
      page: query.page,
      size: query.size,
      sort: ['createdDate,desc'],
    });
    return komgaOpdsFeed({
      kind: 'acquisition',
      id: 'latestBooks',
      title: 'Latest books',
      selfPath: selfPath('/books/latest', query),
      entries: records.map((record) => komgaOpdsBookEntry(record, true)),
      paging: { page, total },
    });
  }

  private async seriesFeed(
    user: RequestUser,
    account: KomgaRequestAccount,
    query: KomgaOpdsQuery,
    feed: { id: string; title: string; path: string; listQuery: Partial<SeriesListQuery> },
  ): Promise<string> {
    const { records, aggregates, page, total } = await this.seriesService.listRecords(user, account, {
      ...feed.listQuery,
      page: query.page,
      size: query.size,
    } as SeriesListQuery);
    return komgaOpdsFeed({
      kind: 'navigation',
      id: feed.id,
      title: feed.title,
      selfPath: selfPath(feed.path, query),
      extraLinks: [komgaOpdsSearchLink()],
      entries: records.map((record) => komgaOpdsSeriesEntry(record, aggregates.get(formatSeriesId(record.key)))),
      paging: { page, total },
    });
  }
}
