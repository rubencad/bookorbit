import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import type { KomgaRequestAccount } from './komga-auth.guard';
import { KomgaBookService, type KomgaBookDto } from './komga-book.service';
import { KOMGA_SERIES_BOOK_SORT_PROPERTIES, KOMGA_SERIES_SORT_PROPERTIES, KomgaCatalogRepository } from './komga-catalog.repository';
import type { KomgaScope, KomgaSeriesRecord } from './komga-catalog.types';
import { formatSeriesId, parseSeriesId } from './komga-ids';
import { KomgaLibraryService } from './komga-library.service';
import { buildKomgaPage, resolvePageRequest, type KomgaPage } from './komga-page-response';
import type { SeriesBooksQuery, SeriesListQuery } from './komga-query';
import { toKomgaBookDto, toKomgaSeriesDto } from './komga.mapper';
import { KOMGA_UNPAGED_MAX_ROWS } from './komga.constants';

export type KomgaSeriesDto = ReturnType<typeof toKomgaSeriesDto>;

@Injectable()
export class KomgaSeriesService {
  private readonly logger = new Logger(KomgaSeriesService.name);

  constructor(
    private readonly repository: KomgaCatalogRepository,
    private readonly libraryService: KomgaLibraryService,
    private readonly bookService: KomgaBookService,
  ) {}

  async list(user: RequestUser, account: KomgaRequestAccount, query: SeriesListQuery): Promise<KomgaPage<KomgaSeriesDto>> {
    const page = resolvePageRequest(query, {
      defaultSort: [{ property: 'metadata.titleSort', direction: 'asc' }],
      sortableProperties: KOMGA_SERIES_SORT_PROPERTIES,
    });
    if (query.deleted === true) return buildKomgaPage<KomgaSeriesDto>([], page, 0);

    const scope = await this.libraryService.resolveScope(user, account, query.library_id);
    const { rows, total } = await this.repository.listSeries(
      scope,
      {
        search: query.search,
        statuses: query.status,
        genres: query.genre,
        tags: query.tag,
        publishers: query.publisher,
        languages: query.language,
        authors: query.author,
        oneshot: query.oneshot,
      },
      page,
    );
    const aggregates = await this.repository.aggregateSeries(
      scope,
      rows.map((row) => row.key),
    );
    return buildKomgaPage(
      rows.map((row) => toKomgaSeriesDto(row, aggregates.get(formatSeriesId(row.key))!)),
      page,
      total,
    );
  }

  async get(user: RequestUser, account: KomgaRequestAccount, seriesId: string): Promise<KomgaSeriesDto> {
    const scope = await this.libraryService.resolveScope(user, account);
    const series = await this.requireSeries(scope, seriesId);
    const aggregates = await this.repository.aggregateSeries(scope, [series.key]);
    return toKomgaSeriesDto(series, aggregates.get(formatSeriesId(series.key))!);
  }

  async listBooks(user: RequestUser, account: KomgaRequestAccount, seriesId: string, query: SeriesBooksQuery): Promise<KomgaPage<KomgaBookDto>> {
    const page = resolvePageRequest(query, {
      defaultSort: [{ property: 'metadata.numberSort', direction: 'asc' }],
      sortableProperties: KOMGA_SERIES_BOOK_SORT_PROPERTIES,
      allowUnpaged: true,
    });
    if (query.deleted === true) return buildKomgaPage<KomgaBookDto>([], page, 0);

    const scope = await this.libraryService.resolveScope(user, account);
    const series = await this.requireSeries(scope, seriesId);
    const { bookIds, total } = await this.repository.listSeriesBooks(scope, series.key, { mediaStatuses: query.media_status, tags: query.tag }, page);
    if (page.unpaged && total > KOMGA_UNPAGED_MAX_ROWS) {
      this.logger.warn(
        `[komga.series_books] [end] seriesId=${seriesId} userId=${user.id} total=${total} cap=${KOMGA_UNPAGED_MAX_ROWS} - unpaged series books truncated to the cap`,
      );
    }
    const records = await this.bookService.buildRecords(scope, bookIds, series.key);
    return buildKomgaPage(records.map(toKomgaBookDto), page, total);
  }

  private async requireSeries(scope: KomgaScope, seriesId: string): Promise<KomgaSeriesRecord> {
    const key = parseSeriesId(seriesId);
    if (!key) throw new NotFoundException('Series not found');
    const series = await this.repository.findSeries(scope, key);
    if (!series) throw new NotFoundException('Series not found');
    return series;
  }
}
