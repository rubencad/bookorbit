import { EBOOK_FORMAT_LIST } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { isComicContainerFormat } from '../../common/comic-format-detect';
import type { ComicPageEntry } from '../comic-pages/lib/comic-page-entry';
import type { KomgaRequestAccount } from './komga-auth.guard';
import type { KomgaBookRecord, KomgaLibraryRecord, KomgaSeriesAggregate, KomgaSeriesRecord } from './komga-catalog.types';
import { formatSeriesId } from './komga-ids';
import { KOMGA_ROLES } from './komga.constants';

export type KomgaMediaProfile = 'DIVINA' | 'EPUB' | 'PDF';
export type KomgaMediaStatus = 'READY' | 'UNSUPPORTED';

export interface KomgaMedia {
  status: KomgaMediaStatus;
  mediaType: string;
  mediaProfile: KomgaMediaProfile;
  epubIsKepub: boolean;
}

const EBOOK_FORMATS: ReadonlySet<string> = new Set(EBOOK_FORMAT_LIST);
const PAGE_LAYOUT_FORMATS: ReadonlySet<string> = new Set(['pdf', 'djvu']);
const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];

export function isKomgaVisibleNonComicFormat(format: string | null): boolean {
  return format !== null && EBOOK_FORMATS.has(format.toLowerCase());
}

export function komgaMediaFor(format: string): KomgaMedia {
  const normalized = format.toLowerCase();
  if (isComicContainerFormat(normalized)) {
    return { status: 'READY', mediaProfile: 'DIVINA', mediaType: komgaMediaType(normalized), epubIsKepub: false };
  }
  if (PAGE_LAYOUT_FORMATS.has(normalized)) {
    return { status: 'UNSUPPORTED', mediaProfile: 'PDF', mediaType: komgaMediaType(normalized), epubIsKepub: false };
  }
  return { status: 'READY', mediaProfile: 'EPUB', mediaType: komgaMediaType(normalized), epubIsKepub: normalized === 'kepub' };
}

export function komgaMediaType(format: string): string {
  switch (format.toLowerCase()) {
    case 'cbz':
      return 'application/vnd.comicbook+zip';
    case 'cbr':
      return 'application/vnd.comicbook-rar';
    case 'cb7':
      return 'application/x-7z-compressed';
    case 'epub':
    case 'kepub':
      return 'application/epub+zip';
    case 'pdf':
      return 'application/pdf';
    case 'djvu':
      return 'image/vnd.djvu';
    case 'mobi':
      return 'application/x-mobipocket-ebook';
    case 'azw':
    case 'azw3':
      return 'application/vnd.amazon.ebook';
    case 'fb2':
      return 'application/x-fictionbook+xml';
    default:
      return 'application/octet-stream';
  }
}

export function formatKomgaDateTime(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function formatKomgaDate(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export function humanizeBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.floor(bytes)} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${BYTE_UNITS[unit]}`;
}

export function toKomgaLibraryDto(library: KomgaLibraryRecord) {
  return {
    id: String(library.id),
    name: library.name,
    root: '',
    importComicInfoBook: false,
    importComicInfoSeries: false,
    importComicInfoCollection: false,
    importComicInfoReadList: false,
    importComicInfoSeriesAppendVolume: false,
    importEpubBook: false,
    importEpubSeries: false,
    importMylarSeries: false,
    importLocalArtwork: false,
    importBarcodeIsbn: false,
    scanForceModifiedTime: false,
    scanInterval: 'DISABLED',
    scanOnStartup: false,
    scanCbx: false,
    scanPdf: false,
    scanEpub: false,
    scanDirectoryExclusions: [],
    repairExtensions: false,
    convertToCbz: false,
    emptyTrashAfterScan: false,
    seriesCover: 'FIRST',
    hashFiles: false,
    hashPages: false,
    hashKoreader: false,
    analyzeDimensions: false,
    oneshotsDirectory: null,
    unavailable: false,
    created: formatKomgaDateTime(library.createdAt),
    lastModified: formatKomgaDateTime(library.updatedAt),
  };
}

export function seriesStatusFor(series: KomgaSeriesRecord): 'ENDED' | 'ONGOING' {
  return series.expectedBookCount !== null && series.booksCount >= series.expectedBookCount ? 'ENDED' : 'ONGOING';
}

export function toKomgaSeriesDto(series: KomgaSeriesRecord, aggregate: KomgaSeriesAggregate) {
  const created = formatKomgaDateTime(series.createdAt);
  const lastModified = formatKomgaDateTime(series.updatedAt);
  const releaseDate = formatKomgaDate(aggregate.releaseDate);
  return {
    id: formatSeriesId(series.key),
    libraryId: String(series.key.libraryId),
    name: series.name,
    url: '',
    created,
    lastModified,
    fileLastModified: lastModified,
    booksCount: series.booksCount,
    booksReadCount: 0,
    booksUnreadCount: series.booksCount,
    booksInProgressCount: 0,
    metadata: {
      status: seriesStatusFor(series),
      statusLock: false,
      title: series.name,
      titleLock: false,
      titleSort: series.name,
      titleSortLock: false,
      summary: aggregate.summary,
      summaryLock: false,
      readingDirection: 'LEFT_TO_RIGHT',
      readingDirectionLock: false,
      publisher: aggregate.publisher ?? '',
      publisherLock: false,
      ageRating: null,
      ageRatingLock: false,
      language: aggregate.language ?? '',
      languageLock: false,
      genres: aggregate.genres,
      genresLock: false,
      tags: aggregate.tags,
      tagsLock: false,
      totalBookCount: series.expectedBookCount,
      totalBookCountLock: false,
      sharingLabels: [],
      sharingLabelsLock: false,
      links: [],
      linksLock: false,
      alternateTitles: [],
      alternateTitlesLock: false,
      created,
      lastModified,
    },
    booksMetadata: {
      authors: aggregate.authors,
      tags: aggregate.tags,
      releaseDate,
      summary: aggregate.summary,
      summaryNumber: aggregate.summaryNumber,
      created,
      lastModified,
    },
    deleted: false,
    oneshot: series.key.kind === 'oneshot',
  };
}

export function toKomgaBookDto(book: KomgaBookRecord) {
  const media = komgaMediaFor(book.file.format);
  const pagesCount = media.mediaProfile === 'DIVINA' ? Math.max(book.file.pageCount ?? 0, 0) : 0;
  const sizeBytes = book.file.sizeBytes ?? 0;
  const created = formatKomgaDateTime(book.addedAt);
  return {
    id: String(book.id),
    seriesId: formatSeriesId(book.series.key),
    seriesTitle: book.series.name,
    libraryId: String(book.libraryId),
    name: book.title,
    url: '',
    number: Math.trunc(book.series.numberSort),
    created,
    lastModified: formatKomgaDateTime(book.updatedAt),
    fileLastModified: formatKomgaDateTime(book.file.mtime ?? book.file.updatedAt),
    sizeBytes,
    size: humanizeBytes(sizeBytes),
    media: {
      status: media.status,
      mediaType: media.mediaType,
      pagesCount,
      comment: '',
      epubDivinaCompatible: false,
      epubIsKepub: media.epubIsKepub,
      mediaProfile: media.mediaProfile,
    },
    metadata: {
      title: book.title,
      titleLock: false,
      summary: book.description ?? '',
      summaryLock: false,
      number: book.series.number,
      numberLock: false,
      numberSort: book.series.numberSort,
      numberSortLock: false,
      releaseDate: formatKomgaDate(book.publishedDate),
      releaseDateLock: false,
      authors: book.authors,
      authorsLock: false,
      tags: book.tags,
      tagsLock: false,
      isbn: book.isbn13 ?? book.isbn10 ?? '',
      isbnLock: false,
      links: [],
      linksLock: false,
      created,
      lastModified: formatKomgaDateTime(book.metadataUpdatedAt ?? book.updatedAt),
    },
    readProgress: null,
    deleted: false,
    fileHash: book.file.fileHash ?? '',
    oneshot: book.series.key.kind === 'oneshot',
  };
}

export function toKomgaPageDto(page: ComicPageEntry) {
  return {
    number: page.index + 1,
    fileName: page.entryName.split('/').pop() ?? page.entryName,
    mediaType: page.mimeType,
    width: null,
    height: null,
    sizeBytes: page.sizeBytes,
    size: humanizeBytes(page.sizeBytes),
  };
}

export function toKomgaUserDto(account: KomgaRequestAccount, user: RequestUser, accessibleLibraryIds: number[]) {
  return {
    id: String(account.id),
    email: user.email ?? `${user.username}@bookorbit.local`,
    roles: [...KOMGA_ROLES],
    sharedAllLibraries: user.isSuperuser,
    sharedLibrariesIds: user.isSuperuser ? [] : accessibleLibraryIds.map(String),
    labelsAllow: [],
    labelsExclude: [],
    ageRestriction: null,
  };
}
