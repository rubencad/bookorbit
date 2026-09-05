import { Injectable, NotFoundException } from '@nestjs/common';
import { basename } from 'path';

import { isComicContainerFormat } from '../../common/comic-format-detect';
import type { RequestUser } from '../../common/types/request-user';
import type { KomgaRequestAccount } from './komga-auth.guard';
import { KOMGA_BOOK_SORT_PROPERTIES, KomgaCatalogRepository, type KomgaBookRow, type KomgaComicCreditsRow } from './komga-catalog.repository';
import type { KomgaAuthorRef, KomgaBookFileRecord, KomgaBookRecord, KomgaBookSeriesContext, KomgaScope } from './komga-catalog.types';
import { formatSeriesId, type KomgaSeriesKey } from './komga-ids';
import { KomgaLibraryService } from './komga-library.service';
import { buildKomgaPage, resolvePageRequest, type KomgaPage } from './komga-page-response';
import type { BookListQuery } from './komga-query';
import { isKomgaVisibleNonComicFormat, toKomgaBookDto } from './komga.mapper';
import { KOMGA_UNKNOWN_SERIES_TITLE } from './komga.constants';

export type KomgaBookDto = ReturnType<typeof toKomgaBookDto>;

const CREDIT_ROLES: ReadonlyArray<{ field: keyof Omit<KomgaComicCreditsRow, 'bookId'>; role: KomgaAuthorRef['role'] }> = [
  { field: 'pencillers', role: 'penciller' },
  { field: 'inkers', role: 'inker' },
  { field: 'colorists', role: 'colorist' },
  { field: 'letterers', role: 'letterer' },
  { field: 'coverArtists', role: 'cover' },
];

export function pickKomgaFile(
  files: KomgaBookFileRecord[],
  primaryFileId: number | null,
  formatPriority: readonly string[],
  includeNonComicBooks: boolean,
): KomgaBookFileRecord | null {
  const comics = files.filter((file) => isComicContainerFormat(file.format));
  if (comics.length > 0) {
    const rank = (file: KomgaBookFileRecord) => {
      const index = formatPriority.indexOf(file.format.toLowerCase());
      return index === -1 ? formatPriority.length : index;
    };
    return [...comics].sort((a, b) => rank(a) - rank(b) || Number(a.id !== primaryFileId) - Number(b.id !== primaryFileId) || a.id - b.id)[0] ?? null;
  }
  if (!includeNonComicBooks) return null;
  const primary = files.find((file) => file.id === primaryFileId);
  return primary && isKomgaVisibleNonComicFormat(primary.format) ? primary : null;
}

@Injectable()
export class KomgaBookService {
  constructor(
    private readonly repository: KomgaCatalogRepository,
    private readonly libraryService: KomgaLibraryService,
  ) {}

  async list(user: RequestUser, account: KomgaRequestAccount, query: BookListQuery): Promise<KomgaPage<KomgaBookDto>> {
    const page = resolvePageRequest(query, {
      defaultSort: [{ property: 'metadata.titleSort', direction: 'asc' }],
      sortableProperties: KOMGA_BOOK_SORT_PROPERTIES,
    });
    if (query.deleted === true) return buildKomgaPage<KomgaBookDto>([], page, 0);

    const scope = await this.libraryService.resolveScope(user, account, query.library_id);
    const { bookIds, total } = await this.repository.listBooks(
      scope,
      { search: query.search, mediaStatuses: query.media_status, tags: query.tag, authors: query.author },
      page,
    );
    const records = await this.buildRecords(scope, bookIds);
    return buildKomgaPage(records.map(toKomgaBookDto), page, total);
  }

  async get(user: RequestUser, account: KomgaRequestAccount, bookId: number): Promise<KomgaBookDto> {
    const scope = await this.libraryService.resolveScope(user, account);
    const [record] = await this.buildRecords(scope, [await this.requireVisibleBook(scope, bookId)]);
    if (!record) throw new NotFoundException('Book not found');
    return toKomgaBookDto(record);
  }

  async buildRecords(scope: KomgaScope, bookIds: number[], context?: KomgaSeriesKey): Promise<KomgaBookRecord[]> {
    if (bookIds.length === 0) return [];
    const hydration = await this.repository.hydrateBooks(bookIds);
    const rowsById = new Map(hydration.books.map((row) => [row.id, row]));

    const drafts: Array<{ row: KomgaBookRow; file: KomgaBookFileRecord; key: KomgaSeriesKey; seriesName: string; index: string | null }> = [];
    for (const bookId of bookIds) {
      const row = rowsById.get(bookId);
      if (!row) continue;
      const file = pickKomgaFile(hydration.files.get(bookId) ?? [], row.primaryFileId, row.formatPriority, scope.includeNonComicBooks);
      if (!file) continue;
      const memberships = hydration.memberships.get(bookId) ?? [];
      const membership =
        context?.kind === 'series'
          ? memberships.find((entry) => entry.seriesId === context.seriesId)
          : (memberships.find((entry) => entry.displayOrder === 0) ?? memberships[0]);
      const title = row.title ?? basename(row.folderPath);
      if (membership) {
        drafts.push({
          row,
          file,
          key: { kind: 'series', libraryId: row.libraryId, seriesId: membership.seriesId },
          seriesName: membership.seriesName,
          index: membership.seriesIndex,
        });
      } else if (scope.groupUnknownSeries) {
        drafts.push({ row, file, key: { kind: 'unknown', libraryId: row.libraryId }, seriesName: KOMGA_UNKNOWN_SERIES_TITLE, index: null });
      } else {
        drafts.push({ row, file, key: { kind: 'oneshot', libraryId: row.libraryId, bookId: row.id }, seriesName: title, index: null });
      }
    }

    const unnumberedKeys = new Map<string, KomgaSeriesKey>();
    for (const draft of drafts) {
      if (draft.index === null && draft.key.kind !== 'oneshot') unnumberedKeys.set(formatSeriesId(draft.key), draft.key);
    }
    const numbering = await this.repository.resolveSeriesNumbering(scope, [...unnumberedKeys.values()]);

    return drafts.map(({ row, file, key, seriesName, index }) => {
      const series = this.numberedContext(key, seriesName, index, row.id, numbering.get(formatSeriesId(key)));
      return {
        id: row.id,
        libraryId: row.libraryId,
        title: row.title ?? basename(row.folderPath),
        addedAt: row.addedAt,
        updatedAt: row.updatedAt,
        metadataUpdatedAt: row.metadataUpdatedAt,
        description: row.description,
        publishedDate: row.publishedDate,
        isbn10: row.isbn10,
        isbn13: row.isbn13,
        file,
        series,
        authors: this.authorsFor(hydration.authors.get(row.id) ?? [], hydration.credits.get(row.id)),
        tags: hydration.tags.get(row.id) ?? [],
      };
    });
  }

  private numberedContext(
    key: KomgaSeriesKey,
    name: string,
    index: string | null,
    bookId: number,
    numbering: { maxIndex: number; ordinals: Map<number, number> } | undefined,
  ): KomgaBookSeriesContext {
    if (index !== null) return { key, name, number: index, numberSort: Number(index) };
    if (key.kind === 'oneshot') return { key, name, number: '1', numberSort: 1 };
    const numberSort = (numbering?.maxIndex ?? 0) + (numbering?.ordinals.get(bookId) ?? 1);
    return { key, name, number: String(numberSort), numberSort };
  }

  private authorsFor(writers: string[], credits: KomgaComicCreditsRow | undefined): KomgaAuthorRef[] {
    const refs: KomgaAuthorRef[] = writers.map((name) => ({ name, role: 'writer' as const }));
    if (!credits) return refs;
    for (const { field, role } of CREDIT_ROLES) {
      for (const name of credits[field] ?? []) {
        if (name.trim()) refs.push({ name, role });
      }
    }
    return refs;
  }

  private async requireVisibleBook(scope: KomgaScope, bookId: number): Promise<number> {
    const visible = await this.repository.findVisibleBookId(scope, bookId);
    if (visible === null) throw new NotFoundException('Book not found');
    return visible;
  }
}
