import type { KomgaBookRecord, KomgaLibraryRecord, KomgaSeriesAggregate, KomgaSeriesRecord } from '../komga-catalog.types';
import {
  KOMGA_OPDS_BASE,
  komgaOpdsBookEntry,
  komgaOpdsFeed,
  komgaOpdsLibraryEntry,
  komgaOpdsSearchDescription,
  komgaOpdsSeriesEntry,
} from '../komga-opds.feed';

const updatedAt = new Date('2026-01-02T03:04:05.678Z');

function bookRecord(overrides: Partial<KomgaBookRecord> = {}): KomgaBookRecord {
  return {
    id: 42,
    libraryId: 7,
    title: 'Chapter One',
    addedAt: updatedAt,
    updatedAt,
    metadataUpdatedAt: null,
    description: null,
    publishedDate: null,
    isbn10: null,
    isbn13: null,
    file: {
      id: 5,
      format: 'cbz',
      absolutePath: '/books/Series/Chapter One.cbz',
      sizeBytes: 2048,
      mtime: updatedAt,
      updatedAt,
      fileHash: null,
      pageCount: 24,
      pageMediaType: 'image/jpeg',
    },
    series: { key: { kind: 'series', libraryId: 7, seriesId: 3 }, name: 'A Series', number: '1', numberSort: 1 },
    authors: [{ name: 'Jane Doe', role: 'writer' }],
    tags: [],
    readState: {
      status: null,
      statusSource: null,
      finishedAt: null,
      statusUpdatedAt: null,
      pageNumber: null,
      percentage: null,
      lastReadAt: null,
      progressUpdatedAt: null,
      resetAt: null,
      progressFileId: null,
    },
    ...overrides,
  };
}

function seriesRecord(overrides: Partial<KomgaSeriesRecord> = {}): KomgaSeriesRecord {
  return {
    key: { kind: 'series', libraryId: 7, seriesId: 3 },
    name: 'A Series',
    booksCount: 4,
    booksReadCount: 0,
    booksInProgressCount: 0,
    createdAt: updatedAt,
    updatedAt,
    expectedBookCount: null,
    ...overrides,
  };
}

describe('komgaOpdsFeed', () => {
  it('identifies the server as Komga so clients enable their Komga behaviour', () => {
    const xml = komgaOpdsFeed({ kind: 'navigation', id: 'root', title: 'BookOrbit', selfPath: `${KOMGA_OPDS_BASE}/catalog`, entries: [] });

    expect(xml).toContain('<author>\n    <name>Komga</name>');
    expect(xml).toContain(`<link rel="self" href="${KOMGA_OPDS_BASE}/catalog"`);
    expect(xml).toContain(`<link rel="start" href="${KOMGA_OPDS_BASE}/catalog"`);
  });

  it('emits a next link while more pages remain and stops on the last page', () => {
    const page = { page: 0, size: 20, offset: 0, unpaged: false, sort: [] };
    const more = komgaOpdsFeed({
      kind: 'acquisition',
      id: 'latestBooks',
      title: 'Latest books',
      selfPath: `${KOMGA_OPDS_BASE}/books/latest?page=0`,
      entries: [],
      paging: { page, total: 45 },
    });
    expect(more).toContain('rel="next"');
    expect(more).toContain('href="/komga/opds/v1.2/books/latest?page=1"');
    expect(more).not.toContain('rel="previous"');

    const last = komgaOpdsFeed({
      kind: 'acquisition',
      id: 'latestBooks',
      title: 'Latest books',
      selfPath: `${KOMGA_OPDS_BASE}/books/latest?page=2`,
      entries: [],
      paging: { page: { ...page, page: 2, offset: 40 }, total: 45 },
    });
    expect(last).not.toContain('rel="next"');
    expect(last).toContain('rel="previous"');
  });
});

describe('komgaOpdsBookEntry', () => {
  it('carries the plain book id so clients can address the Komga REST API', () => {
    expect(komgaOpdsBookEntry(bookRecord())).toContain('<id>42</id>');
  });

  it('advertises page streaming with the archive page count', () => {
    const entry = komgaOpdsBookEntry(bookRecord());

    expect(entry).toContain('rel="http://vaemendis.net/opds-pse/stream"');
    expect(entry).toContain(`href="${KOMGA_OPDS_BASE}/books/42/pages/{pageNumber}?convert=jpeg"`);
    expect(entry).toContain('type="image/jpeg"');
    expect(entry).toContain('pse:count="24"');
  });

  it('streams png natively when every page is png', () => {
    const entry = komgaOpdsBookEntry(bookRecord({ file: { ...bookRecord().file, pageMediaType: 'image/png' } }));

    expect(entry).toContain('?convert=png');
    expect(entry).toContain('type="image/png"');
  });

  it('advertises the last read page and versions the entry by the progress modification', () => {
    const lastReadAt = new Date('2026-03-04T05:06:07.890Z');
    const progressUpdatedAt = new Date('2026-03-05T00:00:00.000Z');
    const entry = komgaOpdsBookEntry(
      bookRecord({
        readState: { ...bookRecord().readState, pageNumber: 30, percentage: 100, lastReadAt, progressUpdatedAt },
      }),
    );

    expect(entry).toContain('pse:lastRead="24"');
    expect(entry).toContain('pse:lastReadDate="2026-03-04T05:06:07Z"');
    expect(entry).toContain('<updated>2026-03-05T00:00:00Z</updated>');
  });

  it('advances the entry when a status changes or progress is cleared', () => {
    const statusUpdatedAt = new Date('2026-02-01T00:00:00.000Z');
    const finishedAt = new Date('2025-06-01T00:00:00.000Z');
    const statusOnly = komgaOpdsBookEntry(bookRecord({ readState: { ...bookRecord().readState, status: 'read', finishedAt, statusUpdatedAt } }));
    expect(statusOnly).toContain('pse:lastRead="24"');
    expect(statusOnly).toContain('pse:lastReadDate="2025-06-01T00:00:00Z"');
    expect(statusOnly).toContain('<updated>2026-02-01T00:00:00Z</updated>');

    const cleared = komgaOpdsBookEntry(bookRecord({ readState: { ...bookRecord().readState, resetAt: new Date('2026-04-01T00:00:00.000Z') } }));
    expect(cleared).not.toContain('pse:lastRead');
    expect(cleared).toContain('<updated>2026-04-01T00:00:00Z</updated>');
  });

  it('omits lastRead attributes for unread books', () => {
    const entry = komgaOpdsBookEntry(bookRecord());

    expect(entry).not.toContain('pse:lastRead');
    expect(entry).toContain('<updated>2026-01-02T03:04:05Z</updated>');
  });

  it('omits page streaming for books that are not comics', () => {
    const entry = komgaOpdsBookEntry(
      bookRecord({ file: { ...bookRecord().file, format: 'epub', absolutePath: '/books/a.epub', pageCount: null, pageMediaType: null } }),
    );

    expect(entry).not.toContain('opds-pse/stream');
    expect(entry).toContain('type="application/epub+zip"');
  });

  it('omits page streaming when the archive has not been counted yet', () => {
    expect(komgaOpdsBookEntry(bookRecord({ file: { ...bookRecord().file, pageCount: null } }))).not.toContain('opds-pse/stream');
  });

  it('prefixes the series title when asked, for feeds that mix series', () => {
    expect(komgaOpdsBookEntry(bookRecord(), true)).toContain('<title>A Series 1: Chapter One</title>');
    expect(komgaOpdsBookEntry(bookRecord())).toContain('<title>Chapter One</title>');
  });

  it('escapes titles that would otherwise break the feed', () => {
    const entry = komgaOpdsBookEntry(bookRecord({ title: 'Tom & Jerry <1>' }));

    expect(entry).toContain('<title>Tom &amp; Jerry &lt;1&gt;</title>');
  });

  it('links the acquisition to a url-safe file name', () => {
    const entry = komgaOpdsBookEntry(bookRecord({ file: { ...bookRecord().file, absolutePath: '/books/A & B;.cbz' } }));

    expect(entry).toContain(`href="${KOMGA_OPDS_BASE}/books/42/file/A%20%26%20B.cbz"`);
  });
});

describe('komgaOpdsSeriesEntry', () => {
  it('links a series to its acquisition feed by Komga series id', () => {
    const aggregate = { summary: 'A summary' } as KomgaSeriesAggregate;
    const entry = komgaOpdsSeriesEntry(seriesRecord(), aggregate);

    expect(entry).toContain('<id>7-s3</id>');
    expect(entry).toContain(`href="${KOMGA_OPDS_BASE}/series/7-s3"`);
    expect(entry).toContain('A summary');
  });
});

describe('komgaOpdsLibraryEntry', () => {
  it('links a library to its series feed', () => {
    const library: KomgaLibraryRecord = { id: 7, name: 'Comics', createdAt: updatedAt, updatedAt };

    expect(komgaOpdsLibraryEntry(library)).toContain(`href="${KOMGA_OPDS_BASE}/libraries/7"`);
  });
});

describe('komgaOpdsSearchDescription', () => {
  it('templates search onto the series feed', () => {
    expect(komgaOpdsSearchDescription()).toContain(`template="${KOMGA_OPDS_BASE}/series?search={searchTerms}"`);
  });
});
