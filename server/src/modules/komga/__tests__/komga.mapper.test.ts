import type { RequestUser } from '../../../common/types/request-user';
import type { KomgaRequestAccount } from '../komga-auth.guard';
import type { KomgaBookReadState, KomgaBookRecord, KomgaSeriesAggregate, KomgaSeriesRecord } from '../komga-catalog.types';
import {
  formatKomgaDate,
  formatKomgaDateTime,
  humanizeBytes,
  isKomgaVisibleNonComicFormat,
  komgaMediaFor,
  komgaReadProgressFor,
  seriesStatusFor,
  toKomgaBookDto,
  toKomgaLibraryDto,
  toKomgaPageDto,
  toKomgaSeriesDto,
  toKomgaUserDto,
} from '../komga.mapper';

function series(overrides: Partial<KomgaSeriesRecord> = {}): KomgaSeriesRecord {
  return {
    key: { kind: 'series', libraryId: 2, seriesId: 9 },
    name: 'Saga',
    booksCount: 3,
    booksReadCount: 0,
    booksInProgressCount: 0,
    createdAt: new Date('2026-01-02T03:04:05.678Z'),
    updatedAt: new Date('2026-02-03T04:05:06.789Z'),
    expectedBookCount: null,
    ...overrides,
  };
}

function readState(overrides: Partial<KomgaBookReadState> = {}): KomgaBookReadState {
  return {
    status: null,
    statusSource: null,
    finishedAt: null,
    statusUpdatedAt: null,
    pageNumber: null,
    percentage: null,
    lastReadAt: null,
    progressUpdatedAt: null,
    ...overrides,
  };
}

function aggregate(overrides: Partial<KomgaSeriesAggregate> = {}): KomgaSeriesAggregate {
  return {
    lowestBookId: 10,
    summary: 'A summary',
    summaryNumber: '1',
    publisher: 'Image',
    language: 'en',
    releaseDate: '2012-03-14',
    genres: ['Science Fiction'],
    tags: ['space'],
    authors: [{ name: 'Brian K. Vaughan', role: 'writer' }],
    ...overrides,
  };
}

function book(overrides: Partial<KomgaBookRecord> = {}): KomgaBookRecord {
  return {
    id: 10,
    libraryId: 2,
    title: 'Saga Volume 1',
    addedAt: new Date('2026-01-02T03:04:05.678Z'),
    updatedAt: new Date('2026-02-03T04:05:06.000Z'),
    metadataUpdatedAt: new Date('2026-02-04T00:00:00.000Z'),
    description: 'First volume',
    publishedDate: '2012-10-10',
    isbn10: '1607066017',
    isbn13: '9781607066019',
    file: {
      id: 77,
      format: 'cbz',
      absolutePath: '/books/saga/v1.cbz',
      sizeBytes: 3 * 1024 * 1024,
      mtime: new Date('2025-12-31T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      fileHash: 'abc123',
      pageCount: 142,
      pageMediaType: 'image/jpeg',
    },
    series: { key: { kind: 'series', libraryId: 2, seriesId: 9 }, name: 'Saga', number: '1.5', numberSort: 1.5 },
    authors: [{ name: 'Fiona Staples', role: 'penciller' }],
    tags: ['space'],
    readState: readState(),
    ...overrides,
  };
}

describe('komga mapper', () => {
  it('formats date-times without milliseconds and dates only when well formed', () => {
    expect(formatKomgaDateTime(new Date('2026-01-02T03:04:05.678Z'))).toBe('2026-01-02T03:04:05Z');
    expect(formatKomgaDate('2012-03-14')).toBe('2012-03-14');
    expect(formatKomgaDate('2012')).toBeNull();
    expect(formatKomgaDate(null)).toBeNull();
  });

  it('humanizes byte counts with binary units', () => {
    expect(humanizeBytes(0)).toBe('0 B');
    expect(humanizeBytes(512)).toBe('512 B');
    expect(humanizeBytes(1536)).toBe('1.5 KiB');
    expect(humanizeBytes(3 * 1024 * 1024)).toBe('3.0 MiB');
    expect(humanizeBytes(-5)).toBe('0 B');
  });

  it('maps formats to Komga media profiles and statuses', () => {
    expect(komgaMediaFor('cbr')).toEqual({ status: 'READY', mediaProfile: 'DIVINA', mediaType: 'application/vnd.comicbook-rar', epubIsKepub: false });
    expect(komgaMediaFor('kepub')).toEqual({ status: 'READY', mediaProfile: 'EPUB', mediaType: 'application/epub+zip', epubIsKepub: true });
    expect(komgaMediaFor('pdf')).toEqual({ status: 'UNSUPPORTED', mediaProfile: 'PDF', mediaType: 'application/pdf', epubIsKepub: false });
    expect(isKomgaVisibleNonComicFormat('epub')).toBe(true);
    expect(isKomgaVisibleNonComicFormat('mp3')).toBe(false);
    expect(isKomgaVisibleNonComicFormat(null)).toBe(false);
  });

  it('derives the series status from the expected book count', () => {
    expect(seriesStatusFor(series())).toBe('ONGOING');
    expect(seriesStatusFor(series({ expectedBookCount: 5 }))).toBe('ONGOING');
    expect(seriesStatusFor(series({ expectedBookCount: 3 }))).toBe('ENDED');
  });

  it('builds a series dto with composite ids, per-user counters and aggregated metadata', () => {
    const dto = toKomgaSeriesDto(series({ expectedBookCount: 3, booksReadCount: 1, booksInProgressCount: 1 }), aggregate());
    expect(dto).toMatchObject({
      id: '2-s9',
      libraryId: '2',
      name: 'Saga',
      url: '',
      created: '2026-01-02T03:04:05Z',
      lastModified: '2026-02-03T04:05:06Z',
      fileLastModified: '2026-02-03T04:05:06Z',
      booksCount: 3,
      booksReadCount: 1,
      booksUnreadCount: 1,
      booksInProgressCount: 1,
      deleted: false,
      oneshot: false,
    });
    expect(dto.metadata).toMatchObject({
      status: 'ENDED',
      title: 'Saga',
      titleSort: 'Saga',
      summary: 'A summary',
      readingDirection: 'LEFT_TO_RIGHT',
      publisher: 'Image',
      language: 'en',
      genres: ['Science Fiction'],
      tags: ['space'],
      totalBookCount: 3,
      ageRating: null,
      sharingLabels: [],
      links: [],
      alternateTitles: [],
    });
    expect(dto.booksMetadata).toEqual({
      authors: [{ name: 'Brian K. Vaughan', role: 'writer' }],
      tags: ['space'],
      releaseDate: '2012-03-14',
      summary: 'A summary',
      summaryNumber: '1',
      created: '2026-01-02T03:04:05Z',
      lastModified: '2026-02-03T04:05:06Z',
    });
    expect(
      Object.keys(dto.metadata)
        .filter((key) => key.endsWith('Lock'))
        .every((key) => (dto.metadata as Record<string, unknown>)[key] === false),
    ).toBe(true);
  });

  it('derives read progress from the progress row and the read status', () => {
    const readAt = new Date('2026-03-01T10:00:00.000Z');
    const modifiedAt = new Date('2026-03-01T10:00:01.000Z');
    const inProgress = book({ readState: readState({ pageNumber: 12, percentage: 8, lastReadAt: readAt, progressUpdatedAt: modifiedAt }) });
    expect(komgaReadProgressFor(inProgress)).toEqual({ page: 12, completed: false, readAt, modifiedAt });

    const finishedByPercentage = book({
      readState: readState({ pageNumber: 142, percentage: 100, lastReadAt: readAt, progressUpdatedAt: modifiedAt }),
    });
    expect(komgaReadProgressFor(finishedByPercentage)?.completed).toBe(true);

    const finishedByStatus = book({
      readState: readState({ status: 'read', pageNumber: 12, percentage: 8, lastReadAt: readAt, progressUpdatedAt: modifiedAt }),
    });
    expect(komgaReadProgressFor(finishedByStatus)).toEqual({ page: 12, completed: true, readAt, modifiedAt });

    const estimated = book({ readState: readState({ pageNumber: null, percentage: 50, lastReadAt: readAt, progressUpdatedAt: modifiedAt }) });
    expect(komgaReadProgressFor(estimated)?.page).toBe(71);

    const beyondEnd = book({ readState: readState({ pageNumber: 900, percentage: 99, lastReadAt: readAt, progressUpdatedAt: modifiedAt }) });
    expect(komgaReadProgressFor(beyondEnd)?.page).toBe(142);
  });

  it('reports a status-only read as completed on the last page and nothing for untouched books', () => {
    const finishedAt = new Date('2026-02-20T00:00:00.000Z');
    const statusUpdatedAt = new Date('2026-02-21T00:00:00.000Z');
    const statusOnly = book({ readState: readState({ status: 'read', statusSource: 'manual', finishedAt, statusUpdatedAt }) });
    expect(komgaReadProgressFor(statusOnly)).toEqual({ page: 142, completed: true, readAt: finishedAt, modifiedAt: statusUpdatedAt });
    expect(toKomgaBookDto(statusOnly).readProgress).toEqual({
      page: 142,
      completed: true,
      readDate: '2026-02-20T00:00:00Z',
      created: '2026-02-21T00:00:00Z',
      lastModified: '2026-02-21T00:00:00Z',
      deviceId: '',
      deviceName: 'BookOrbit',
    });

    expect(komgaReadProgressFor(book({ readState: readState({ status: 'reading', statusUpdatedAt }) }))).toBeNull();
    expect(toKomgaBookDto(book()).readProgress).toBeNull();
  });

  it('marks oneshot series and empties missing aggregate values', () => {
    const dto = toKomgaSeriesDto(
      series({ key: { kind: 'oneshot', libraryId: 2, bookId: 10 }, name: 'Standalone' }),
      aggregate({ publisher: null, language: null, releaseDate: null }),
    );
    expect(dto).toMatchObject({ id: '2-b10', oneshot: true });
    expect(dto.metadata).toMatchObject({ publisher: '', language: '' });
    expect(dto.booksMetadata.releaseDate).toBeNull();
  });

  it('builds a book dto whose number is the integer part of numberSort', () => {
    const dto = toKomgaBookDto(book());
    expect(dto).toMatchObject({
      id: '10',
      seriesId: '2-s9',
      seriesTitle: 'Saga',
      libraryId: '2',
      name: 'Saga Volume 1',
      url: '',
      number: 1,
      created: '2026-01-02T03:04:05Z',
      lastModified: '2026-02-03T04:05:06Z',
      fileLastModified: '2025-12-31T00:00:00Z',
      sizeBytes: 3 * 1024 * 1024,
      size: '3.0 MiB',
      readProgress: null,
      deleted: false,
      fileHash: 'abc123',
      oneshot: false,
    });
    expect(dto.media).toEqual({
      status: 'READY',
      mediaType: 'application/vnd.comicbook+zip',
      pagesCount: 142,
      comment: '',
      epubDivinaCompatible: false,
      epubIsKepub: false,
      mediaProfile: 'DIVINA',
    });
    expect(dto.metadata).toMatchObject({
      title: 'Saga Volume 1',
      summary: 'First volume',
      number: '1.5',
      numberSort: 1.5,
      releaseDate: '2012-10-10',
      authors: [{ name: 'Fiona Staples', role: 'penciller' }],
      tags: ['space'],
      isbn: '9781607066019',
      links: [],
      lastModified: '2026-02-04T00:00:00Z',
    });
  });

  it('reports zero pages for non-comics, falls back through isbn and file timestamps', () => {
    const dto = toKomgaBookDto(
      book({
        isbn13: null,
        metadataUpdatedAt: null,
        file: { ...book().file, format: 'epub', pageCount: 500, mtime: null, sizeBytes: null, fileHash: null },
      }),
    );
    expect(dto.media).toMatchObject({ mediaProfile: 'EPUB', pagesCount: 0, mediaType: 'application/epub+zip' });
    expect(dto).toMatchObject({ sizeBytes: 0, size: '0 B', fileHash: '', fileLastModified: '2026-01-01T00:00:00Z' });
    expect(dto.metadata).toMatchObject({ isbn: '1607066017', lastModified: '2026-02-03T04:05:06Z' });
    expect(toKomgaBookDto(book({ isbn13: null, isbn10: null })).metadata.isbn).toBe('');
  });

  it('maps library rows with every import flag off and no filesystem root', () => {
    const dto = toKomgaLibraryDto({
      id: 4,
      name: 'Comics',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
    });
    expect(dto).toMatchObject({
      id: '4',
      name: 'Comics',
      root: '',
      unavailable: false,
      scanInterval: 'DISABLED',
      seriesCover: 'FIRST',
      oneshotsDirectory: null,
    });
    const flags = Object.entries(dto).filter(
      ([key]) => /^(import|scan|hash)/.test(key) && key !== 'scanInterval' && key !== 'scanDirectoryExclusions',
    );
    expect(flags.length).toBeGreaterThan(10);
    expect(flags.every(([, value]) => value === false)).toBe(true);
  });

  it('numbers pages from one and exposes only the entry basename', () => {
    expect(toKomgaPageDto({ index: 2, entryName: 'Saga/pages/003.jpg', mimeType: 'image/jpeg', sizeBytes: 2048 })).toEqual({
      number: 3,
      fileName: '003.jpg',
      mediaType: 'image/jpeg',
      width: null,
      height: null,
      sizeBytes: 2048,
      size: '2.0 KiB',
    });
  });

  it('describes the account with reader roles and library sharing', () => {
    const account: KomgaRequestAccount = { id: 5, userId: 1, username: 'mihon', groupUnknownSeries: true, includeNonComicBooks: false };
    const user = { username: 'ruben', email: null, isSuperuser: false } as RequestUser;
    expect(toKomgaUserDto(account, user, [1, 2])).toEqual({
      id: '5',
      email: 'ruben@bookorbit.local',
      roles: ['USER', 'PAGE_STREAMING', 'FILE_DOWNLOAD'],
      sharedAllLibraries: false,
      sharedLibrariesIds: ['1', '2'],
      labelsAllow: [],
      labelsExclude: [],
      ageRestriction: null,
    });
    const superuser = { username: 'admin', email: 'admin@example.com', isSuperuser: true } as RequestUser;
    expect(toKomgaUserDto(account, superuser, [1, 2])).toMatchObject({
      email: 'admin@example.com',
      sharedAllLibraries: true,
      sharedLibrariesIds: [],
    });
  });
});
