import { randomUUID } from 'crypto';
import { stat } from 'fs/promises';

import { and, eq } from 'drizzle-orm';
import { Permission } from '@bookorbit/types';
import sharp from 'sharp';

import { normalizeMetadataTextKey } from '../src/common/utils/metadata-text-normalize.utils';
import * as schema from '../src/db/schema';
import { COMIC_PAGE_JPEG, COMIC_PAGE_PNG, createCbzComicFixture } from './e2e/comics/comic-fixture-builder';
import {
  authHeader,
  basicAuth,
  closeKomgaE2EContext,
  createBookCoverArtifacts,
  createKomgaE2EContext,
  createKomgaUserCredential,
  createLibraryWithFolder,
  createUserAndLogin,
  grantLibraryAccess,
  locateBookByAbsolutePath,
  setUserActive,
  triggerAndWaitForLibraryScan,
  type CreatedLibrary,
  type KomgaE2EContext,
  type LocatedBookFile,
  type TestUserSession,
} from './e2e/komga/komga-harness';
import { createEpubFixture, writeFixtureFile } from './e2e/opds/opds-fixture-builder';

interface Credentials {
  username: string;
  password: string;
}

interface KomgaPageBody<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  number: number;
  size: number;
  first: boolean;
  last: boolean;
  numberOfElements: number;
  pageable: { pageNumber: number; pageSize: number; paged: boolean; unpaged: boolean; offset: number };
}

interface SeriesBody {
  id: string;
  name: string;
  libraryId: string;
  booksCount: number;
  oneshot: boolean;
  metadata: { title: string; status: string; genres: string[]; tags: string[]; publisher: string; summary: string };
  booksMetadata: { authors: { name: string; role: string }[]; summary: string; summaryNumber: string };
}

interface BookBody {
  id: string;
  seriesId: string;
  seriesTitle: string;
  libraryId: string;
  name: string;
  number: number;
  url: string;
  sizeBytes: number;
  media: { status: string; mediaType: string; pagesCount: number; mediaProfile: string; epubIsKepub: boolean };
  metadata: { title: string; number: string; numberSort: number; authors: { name: string; role: string }[]; tags: string[]; isbn: string };
  readProgress: ReadProgressBody | null;
  oneshot: boolean;
}

interface ReadProgressBody {
  page: number;
  completed: boolean;
  readDate: string;
  created: string;
  lastModified: string;
  deviceId: string;
  deviceName: string;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8]);

describe('Komga API (e2e)', { timeout: 180_000 }, () => {
  let ctx!: KomgaE2EContext;

  let owner!: TestUserSession;
  let peer!: TestUserSession;
  let noPermissionUser!: TestUserSession;
  let disabledParent!: TestUserSession;
  let revokedParent!: TestUserSession;
  let filteredReader!: TestUserSession;
  let superuser!: TestUserSession;

  let comicLibrary!: CreatedLibrary;
  let hiddenLibrary!: CreatedLibrary;

  let alphaOne!: LocatedBookFile;
  let alphaTwo!: LocatedBookFile;
  let crossover!: LocatedBookFile;
  let alphaLoose!: LocatedBookFile;
  let standalone!: LocatedBookFile;
  let manualPdf!: LocatedBookFile;
  let novelEpub!: LocatedBookFile;
  let hiddenComic!: LocatedBookFile;
  let pngPage!: Buffer;

  let seriesAId!: number;
  let seriesBId!: number;

  let grouped!: Credentials;
  let flat!: Credentials;
  let peerCredentials!: Credentials;
  let disabledCredentials!: Credentials;
  let revokedCredentials!: Credentials;
  let filteredCredentials!: Credentials;
  let superuserCredentials!: Credentials;

  const ownerEmail = `komga-owner-${randomUUID().slice(0, 8)}@example.com`;
  const comicLibraryName = `komga-comics-${randomUUID()}`;
  const hiddenLibraryName = `komga-hidden-${randomUUID()}`;
  const seriesAName = `Series A ${randomUUID().slice(0, 6)}`;
  const seriesBName = `Series B ${randomUUID().slice(0, 6)}`;
  const matureTag = `mature-${randomUUID().slice(0, 6)}`;
  const writerName = `Jane Writer ${randomUUID().slice(0, 6)}`;
  const hiddenTag = `hidden-${randomUUID().slice(0, 6)}`;

  beforeAll(async () => {
    ctx = await createKomgaE2EContext();

    comicLibrary = await createLibraryWithFolder(ctx, { name: comicLibraryName });
    hiddenLibrary = await createLibraryWithFolder(ctx, { name: hiddenLibraryName });

    const twoJpegPages = [
      { path: 'pages/001.jpg', content: COMIC_PAGE_JPEG },
      { path: 'pages/002.jpg', content: COMIC_PAGE_JPEG },
    ];
    const alphaOnePath = await createCbzComicFixture(comicLibrary.folderPath, 'series-a/alpha-one.cbz', twoJpegPages);
    pngPage = await sharp({ create: { width: 8, height: 4, channels: 3, background: '#336699' } })
      .png()
      .toBuffer();
    const alphaTwoPath = await createCbzComicFixture(comicLibrary.folderPath, 'series-a/alpha-two.cbz', [
      { path: 'pages/001.png', content: pngPage },
      { path: 'pages/002.jpg', content: COMIC_PAGE_JPEG },
      { path: '.hidden/003.png', content: COMIC_PAGE_PNG },
    ]);
    const crossoverPath = await createCbzComicFixture(comicLibrary.folderPath, 'series-a/crossover.cbz', twoJpegPages);
    const alphaLoosePath = await createCbzComicFixture(comicLibrary.folderPath, 'series-a/alpha-loose.cbz', twoJpegPages);
    const standalonePath = await createCbzComicFixture(comicLibrary.folderPath, 'standalone.cbz', twoJpegPages);
    const manualPdfPath = await writeFixtureFile(
      comicLibrary.folderPath,
      'manual.pdf',
      '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n',
    );
    const novelEpubPath = await createEpubFixture(comicLibrary.folderPath, 'novel.epub', { title: 'Novel' });
    const hiddenComicPath = await createCbzComicFixture(hiddenLibrary.folderPath, 'hidden.cbz', twoJpegPages);

    await triggerAndWaitForLibraryScan(ctx, comicLibrary.libraryId);
    await triggerAndWaitForLibraryScan(ctx, hiddenLibrary.libraryId);

    alphaOne = await locateBookByAbsolutePath(ctx, alphaOnePath);
    alphaTwo = await locateBookByAbsolutePath(ctx, alphaTwoPath);
    crossover = await locateBookByAbsolutePath(ctx, crossoverPath);
    alphaLoose = await locateBookByAbsolutePath(ctx, alphaLoosePath);
    standalone = await locateBookByAbsolutePath(ctx, standalonePath);
    manualPdf = await locateBookByAbsolutePath(ctx, manualPdfPath);
    novelEpub = await locateBookByAbsolutePath(ctx, novelEpubPath);
    hiddenComic = await locateBookByAbsolutePath(ctx, hiddenComicPath);

    await seedTitle(alphaOne.bookId, 'Alpha One', 'The first issue.');
    await seedPublishedDate(alphaOne.bookId, '2012-03-14');
    await seedTitle(alphaTwo.bookId, 'Alpha Two');
    await seedTitle(crossover.bookId, 'Crossover');
    await seedTitle(alphaLoose.bookId, 'Alpha Loose');
    await seedTitle(standalone.bookId, 'Standalone');
    await seedTitle(manualPdf.bookId, 'Manual');
    await seedTitle(novelEpub.bookId, 'Novel');
    await seedTitle(hiddenComic.bookId, 'Hidden');

    seriesAId = await seedSeries(seriesAName);
    seriesBId = await seedSeries(seriesBName);
    await seedMembership(alphaOne.bookId, seriesAId, '1', 0);
    await seedMembership(alphaTwo.bookId, seriesAId, '2', 0);
    await seedMembership(crossover.bookId, seriesBId, '1', 0);
    await seedMembership(crossover.bookId, seriesAId, '3', 1);
    await seedMembership(alphaLoose.bookId, seriesAId, null, 0);
    await seedMembership(hiddenComic.bookId, seriesAId, '9', 0);

    const matureTagId = await seedTag(alphaTwo.bookId, matureTag);
    await seedTag(hiddenComic.bookId, hiddenTag);
    await seedAuthor(alphaOne.bookId, writerName);
    await createBookCoverArtifacts(ctx, alphaOne.bookId, { thumbnailContent: Buffer.from(`thumb-${alphaOne.bookId}`) });

    owner = await createUserAndLogin(ctx, { permissions: [Permission.KomgaAccess], email: ownerEmail });
    peer = await createUserAndLogin(ctx, { permissions: [Permission.KomgaAccess] });
    noPermissionUser = await createUserAndLogin(ctx, { permissions: [] });
    disabledParent = await createUserAndLogin(ctx, { permissions: [Permission.KomgaAccess] });
    revokedParent = await createUserAndLogin(ctx, { permissions: [] });
    filteredReader = await createUserAndLogin(ctx, { permissions: [Permission.KomgaAccess] });
    superuser = await createUserAndLogin(ctx, { permissions: [], isSuperuser: true });

    await grantLibraryAccess(ctx, owner.userId, comicLibrary.libraryId, 'viewer');
    await grantLibraryAccess(ctx, disabledParent.userId, comicLibrary.libraryId, 'viewer');
    await grantLibraryAccess(ctx, revokedParent.userId, comicLibrary.libraryId, 'viewer');
    await grantLibraryAccess(ctx, filteredReader.userId, comicLibrary.libraryId, 'viewer');
    await setUserActive(ctx, disabledParent.userId, false);
    await ctx.db.insert(schema.userContentFilterTags).values({ userId: filteredReader.userId, filterType: 'exclude', tagId: matureTagId });

    grouped = await credentialsFor(owner.userId, { groupUnknownSeries: true, includeNonComicBooks: false });
    flat = await credentialsFor(owner.userId, { groupUnknownSeries: false, includeNonComicBooks: true });
    peerCredentials = await credentialsFor(peer.userId, {});
    disabledCredentials = await credentialsFor(disabledParent.userId, {});
    revokedCredentials = await credentialsFor(revokedParent.userId, {});
    filteredCredentials = await credentialsFor(filteredReader.userId, {});
    superuserCredentials = await credentialsFor(superuser.userId, {});
  }, 180_000);

  afterAll(async () => {
    await closeKomgaE2EContext(ctx);
  });

  describe('authentication and feature flag', () => {
    it('challenges requests without Basic credentials', async () => {
      const response = await komgaGet('/komga/api/v1/libraries');
      expect(response.statusCode).toBe(401);
      expect(response.headers['www-authenticate']).toBe('Basic realm="bookorbit Komga"');
    });

    it('rejects wrong passwords with a challenge', async () => {
      const response = await komgaGet('/komga/api/v1/libraries', { username: grouped.username, password: 'WrongPassword123' });
      expect(response.statusCode).toBe(401);
      expect(response.headers['www-authenticate']).toBe('Basic realm="bookorbit Komga"');
    });

    it('rejects accounts whose parent user is disabled or lost the permission', async () => {
      const disabled = await komgaGet('/komga/api/v1/libraries', disabledCredentials);
      expect(disabled.statusCode).toBe(401);
      expect(disabled.json()).toMatchObject({ message: 'Account is disabled' });

      const revoked = await komgaGet('/komga/api/v1/libraries', revokedCredentials);
      expect(revoked.statusCode).toBe(403);
      expect(revoked.json()).toMatchObject({ message: 'Komga access revoked' });
    });

    it('returns 403 for every route when the API is disabled', async () => {
      await setKomgaApiEnabled(false);
      try {
        const response = await komgaGet('/komga/api/v2/users/me', grouped);
        expect(response.statusCode).toBe(403);
        expect(response.json()).toMatchObject({ message: 'Komga API is disabled' });

        const status = await ctx.app.inject({ method: 'GET', url: '/api/v1/komga-api/status', headers: authHeader(owner.accessToken) });
        expect(status.statusCode).toBe(200);
        expect(status.json()).toEqual({ enabled: false });
      } finally {
        await setKomgaApiEnabled(true);
      }
      expect((await komgaGet('/komga/api/v2/users/me', grouped)).statusCode).toBe(200);
    });

    it('returns a JSON 404 for unknown Komga paths', async () => {
      const response = await komgaGet('/komga/api/v1/tasks', grouped);
      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.json()).toMatchObject({ status: 404, error: 'Not Found', path: '/komga/api/v1/tasks' });
    });
  });

  describe('users/me and libraries', () => {
    it('returns reader roles and accessible libraries for the current account', async () => {
      const v2 = await komgaGet('/komga/api/v2/users/me', grouped);
      expect(v2.statusCode).toBe(200);
      expect(v2.json()).toEqual({
        id: expect.any(String),
        email: ownerEmail,
        roles: ['USER', 'PAGE_STREAMING', 'FILE_DOWNLOAD'],
        sharedAllLibraries: false,
        sharedLibrariesIds: [String(comicLibrary.libraryId)],
        labelsAllow: [],
        labelsExclude: [],
        ageRestriction: null,
      });
      expect(v2.json().roles).not.toContain('ADMIN');

      const v1 = await komgaGet('/komga/api/v1/users/me', grouped);
      expect(v1.statusCode).toBe(200);
      expect(v1.json()).toEqual(v2.json());
    });

    it('falls back to a synthetic email when the parent user has none', async () => {
      const response = await komgaGet('/komga/api/v2/users/me', peerCredentials);
      expect(response.statusCode).toBe(200);
      expect(response.json().sharedLibrariesIds).toEqual([]);
      expect(response.json().email).toMatch(/@/);
    });

    it('lists only accessible libraries and refuses others', async () => {
      const list = await komgaGet('/komga/api/v1/libraries', grouped);
      expect(list.statusCode).toBe(200);
      expect(list.json()).toEqual([
        expect.objectContaining({ id: String(comicLibrary.libraryId), root: '', unavailable: false, scanInterval: 'DISABLED', seriesCover: 'FIRST' }),
      ]);

      const hidden = await komgaGet(`/komga/api/v1/libraries/${hiddenLibrary.libraryId}`, grouped);
      expect(hidden.statusCode).toBe(403);

      const invalid = await komgaGet('/komga/api/v1/libraries/not-a-number', grouped);
      expect(invalid.statusCode).toBe(404);

      const single = await komgaGet(`/komga/api/v1/libraries/${comicLibrary.libraryId}`, grouped);
      expect(single.statusCode).toBe(200);
      expect(single.json().name).toBe(comicLibraryName);
    });
  });

  describe('series', () => {
    it('groups unassigned books into Unknown Series when grouping is enabled', async () => {
      const response = await komgaGet('/komga/api/v1/series', grouped);
      expect(response.statusCode).toBe(200);
      const body = response.json() as KomgaPageBody<SeriesBody>;
      expect(body.content.map((series) => series.name)).toEqual([seriesAName, seriesBName, 'Unknown Series']);
      expect(body).toMatchObject({ totalElements: 3, totalPages: 1, number: 0, first: true, last: true, numberOfElements: 3 });
      expect(body.pageable).toMatchObject({ pageNumber: 0, paged: true, unpaged: false, offset: 0 });

      const [seriesA, seriesB, unknown] = body.content;
      expect(seriesA).toMatchObject({
        id: `${comicLibrary.libraryId}-s${seriesAId}`,
        libraryId: String(comicLibrary.libraryId),
        booksCount: 4,
        oneshot: false,
        metadata: { title: seriesAName, status: 'ONGOING', tags: [matureTag], summary: 'The first issue.' },
        booksMetadata: { authors: [{ name: writerName, role: 'writer' }], summaryNumber: '1' },
      });
      expect(seriesB).toMatchObject({ id: `${comicLibrary.libraryId}-s${seriesBId}`, booksCount: 1 });
      expect(unknown).toMatchObject({ id: `${comicLibrary.libraryId}-u`, booksCount: 1, oneshot: false });
    });

    it('returns standalone books as one-shot series and includes non-comics when enabled', async () => {
      const response = await komgaGet('/komga/api/v1/series', flat);
      expect(response.statusCode).toBe(200);
      const body = response.json() as KomgaPageBody<SeriesBody>;
      expect(body.content.map((series) => series.name)).toEqual(['Manual', 'Novel', seriesAName, seriesBName, 'Standalone']);
      const standaloneSeries = body.content.find((series) => series.name === 'Standalone');
      expect(standaloneSeries).toMatchObject({ id: `${comicLibrary.libraryId}-b${standalone.bookId}`, oneshot: true, booksCount: 1 });

      const oneshotsOnly = await komgaGet('/komga/api/v1/series?oneshot=true', flat);
      expect((oneshotsOnly.json() as KomgaPageBody<SeriesBody>).content.map((series) => series.name)).toEqual(['Manual', 'Novel', 'Standalone']);

      const noOneshots = await komgaGet('/komga/api/v1/series?oneshot=false', flat);
      expect((noOneshots.json() as KomgaPageBody<SeriesBody>).content.map((series) => series.name)).toEqual([seriesAName, seriesBName]);
    });

    it('supports search, library filters, sorting, paging and the deleted flag', async () => {
      const search = await komgaGet(`/komga/api/v1/series?search=${encodeURIComponent('series b')}`, grouped);
      expect((search.json() as KomgaPageBody<SeriesBody>).content.map((series) => series.name)).toEqual([seriesBName]);

      const sorted = await komgaGet('/komga/api/v1/series?sort=metadata.titleSort,desc&size=2&page=0', grouped);
      const sortedBody = sorted.json() as KomgaPageBody<SeriesBody>;
      expect(sortedBody.content.map((series) => series.name)).toEqual(['Unknown Series', seriesBName]);
      expect(sortedBody).toMatchObject({ totalElements: 3, totalPages: 2, last: false, size: 2 });

      const secondPage = await komgaGet('/komga/api/v1/series?sort=metadata.titleSort,desc&size=2&page=1', grouped);
      expect((secondPage.json() as KomgaPageBody<SeriesBody>).content.map((series) => series.name)).toEqual([seriesAName]);

      const byLibrary = await komgaGet(`/komga/api/v1/series?library_id=${comicLibrary.libraryId}`, grouped);
      expect((byLibrary.json() as KomgaPageBody<SeriesBody>).totalElements).toBe(3);

      const hidden = await komgaGet(`/komga/api/v1/series?library_id=${hiddenLibrary.libraryId}`, grouped);
      expect(hidden.statusCode).toBe(403);

      const deleted = await komgaGet('/komga/api/v1/series?deleted=true', grouped);
      expect((deleted.json() as KomgaPageBody<SeriesBody>).content).toEqual([]);

      const badSize = await komgaGet('/komga/api/v1/series?size=0', grouped);
      expect(badSize.statusCode).toBe(400);
    });

    it('filters series by tag and author across member books', async () => {
      const byTag = await komgaGet(`/komga/api/v1/series?tag=${encodeURIComponent(matureTag)}`, grouped);
      expect((byTag.json() as KomgaPageBody<SeriesBody>).content.map((series) => series.name)).toEqual([seriesAName]);

      const byAuthor = await komgaGet(`/komga/api/v1/series?author=${encodeURIComponent(`${writerName},writer`)}`, grouped);
      expect((byAuthor.json() as KomgaPageBody<SeriesBody>).content.map((series) => series.name)).toEqual([seriesAName]);

      const byUnknownTag = await komgaGet('/komga/api/v1/series?tag=nobody-uses-this', grouped);
      expect((byUnknownTag.json() as KomgaPageBody<SeriesBody>).content).toEqual([]);
    });

    it('returns a single series and 404 for ids the account cannot see', async () => {
      const seriesA = await komgaGet(`/komga/api/v1/series/${comicLibrary.libraryId}-s${seriesAId}`, grouped);
      expect(seriesA.statusCode).toBe(200);
      expect(seriesA.json()).toMatchObject({ name: seriesAName, booksCount: 4 });

      expect((await komgaGet(`/komga/api/v1/series/${comicLibrary.libraryId}-b${standalone.bookId}`, grouped)).statusCode).toBe(404);
      expect((await komgaGet(`/komga/api/v1/series/${comicLibrary.libraryId}-u`, flat)).statusCode).toBe(404);
      expect((await komgaGet(`/komga/api/v1/series/${hiddenLibrary.libraryId}-u`, grouped)).statusCode).toBe(404);
      expect((await komgaGet('/komga/api/v1/series/garbage', grouped)).statusCode).toBe(404);
      expect((await komgaGet(`/komga/api/v1/series/${comicLibrary.libraryId}-s${seriesAId}`, peerCredentials)).statusCode).toBe(404);
    });

    it('orders series books by numberSort and uses the requested series context', async () => {
      const response = await komgaGet(
        `/komga/api/v1/series/${comicLibrary.libraryId}-s${seriesAId}/books?unpaged=true&media_status=READY&deleted=false`,
        grouped,
      );
      expect(response.statusCode).toBe(200);
      const body = response.json() as KomgaPageBody<BookBody>;
      expect(body.pageable).toMatchObject({ paged: false, unpaged: true });
      expect(body.content.map((book) => [book.name, book.metadata.number, book.metadata.numberSort, book.number])).toEqual([
        ['Alpha One', '1', 1, 1],
        ['Alpha Two', '2', 2, 2],
        ['Crossover', '3', 3, 3],
        ['Alpha Loose', '4', 4, 4],
      ]);
      for (const book of body.content) {
        expect(book.seriesId).toBe(`${comicLibrary.libraryId}-s${seriesAId}`);
        expect(book.seriesTitle).toBe(seriesAName);
        expect(book.url).toBe('');
        expect(book.readProgress).toBeNull();
        expect(book.media).toMatchObject({ status: 'READY', mediaProfile: 'DIVINA', mediaType: 'application/vnd.comicbook+zip', pagesCount: 2 });
      }
      expect(body.content[0].metadata.authors).toEqual([{ name: writerName, role: 'writer' }]);
      expect(body.content[1].metadata.tags).toEqual([matureTag]);

      const seriesBBooks = await komgaGet(`/komga/api/v1/series/${comicLibrary.libraryId}-s${seriesBId}/books`, grouped);
      expect((seriesBBooks.json() as KomgaPageBody<BookBody>).content).toEqual([
        expect.objectContaining({
          id: String(crossover.bookId),
          seriesId: `${comicLibrary.libraryId}-s${seriesBId}`,
          metadata: expect.objectContaining({ number: '1', numberSort: 1 }),
        }),
      ]);

      const unknownBooks = await komgaGet(`/komga/api/v1/series/${comicLibrary.libraryId}-u/books`, grouped);
      expect((unknownBooks.json() as KomgaPageBody<BookBody>).content).toEqual([
        expect.objectContaining({
          id: String(standalone.bookId),
          seriesTitle: 'Unknown Series',
          metadata: expect.objectContaining({ numberSort: 1 }),
        }),
      ]);
    });

    it('serves the series thumbnail from its lowest numbered book', async () => {
      const response = await komgaGet(`/komga/api/v1/series/${comicLibrary.libraryId}-s${seriesAId}/thumbnail`, grouped);
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('image/jpeg');
      expect(response.rawPayload.toString()).toBe(`thumb-${alphaOne.bookId}`);

      const cached = await ctx.app.inject({
        method: 'GET',
        url: `/komga/api/v1/series/${comicLibrary.libraryId}-s${seriesAId}/thumbnail`,
        headers: { authorization: basicAuth(grouped.username, grouped.password), 'if-none-match': String(response.headers.etag) },
      });
      expect(cached.statusCode).toBe(304);

      expect((await komgaGet(`/komga/api/v1/series/${comicLibrary.libraryId}-s${seriesBId}/thumbnail`, grouped)).statusCode).toBe(404);
    });
  });

  describe('books', () => {
    it('lists books with search and marks PDFs unsupported for accounts that include non-comics', async () => {
      const alpha = await komgaGet('/komga/api/v1/books?search=alpha', grouped);
      expect((alpha.json() as KomgaPageBody<BookBody>).content.map((book) => book.name)).toEqual(['Alpha Loose', 'Alpha One', 'Alpha Two']);

      const all = await komgaGet('/komga/api/v1/books?size=100', flat);
      const books = (all.json() as KomgaPageBody<BookBody>).content;
      expect(books.map((book) => book.name)).toEqual(['Alpha Loose', 'Alpha One', 'Alpha Two', 'Crossover', 'Manual', 'Novel', 'Standalone']);
      expect(books.find((book) => book.name === 'Manual')?.media).toMatchObject({
        status: 'UNSUPPORTED',
        mediaProfile: 'PDF',
        mediaType: 'application/pdf',
        pagesCount: 0,
      });
      expect(books.find((book) => book.name === 'Novel')?.media).toMatchObject({
        status: 'READY',
        mediaProfile: 'EPUB',
        mediaType: 'application/epub+zip',
        pagesCount: 0,
      });
      expect(books.find((book) => book.name === 'Standalone')).toMatchObject({
        seriesId: `${comicLibrary.libraryId}-b${standalone.bookId}`,
        oneshot: true,
      });

      const ready = await komgaGet('/komga/api/v1/books?size=100&media_status=READY', flat);
      expect((ready.json() as KomgaPageBody<BookBody>).content.map((book) => book.name)).not.toContain('Manual');

      const comicsOnly = await komgaGet('/komga/api/v1/books?size=100', grouped);
      expect((comicsOnly.json() as KomgaPageBody<BookBody>).content.map((book) => book.name)).toEqual([
        'Alpha Loose',
        'Alpha One',
        'Alpha Two',
        'Crossover',
        'Standalone',
      ]);
    });

    it('uses the primary series membership for direct book requests', async () => {
      const response = await komgaGet(`/komga/api/v1/books/${crossover.bookId}`, grouped);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        id: String(crossover.bookId),
        seriesId: `${comicLibrary.libraryId}-s${seriesBId}`,
        seriesTitle: seriesBName,
        metadata: { number: '1', numberSort: 1 },
      });

      const loose = await komgaGet(`/komga/api/v1/books/${alphaLoose.bookId}`, grouped);
      expect(loose.json()).toMatchObject({ seriesId: `${comicLibrary.libraryId}-s${seriesAId}`, metadata: { number: '4', numberSort: 4 } });

      expect((await komgaGet(`/komga/api/v1/books/${hiddenComic.bookId}`, grouped)).statusCode).toBe(404);
      expect((await komgaGet(`/komga/api/v1/books/${manualPdf.bookId}`, grouped)).statusCode).toBe(404);
      expect((await komgaGet('/komga/api/v1/books/abc', grouped)).statusCode).toBe(400);
    });

    it('lists pages and streams them one at a time with optional conversion and zero based numbering', async () => {
      const pages = await komgaGet(`/komga/api/v1/books/${alphaTwo.bookId}/pages`, grouped);
      expect(pages.statusCode).toBe(200);
      expect(pages.json()).toEqual([
        {
          number: 1,
          fileName: '001.png',
          mediaType: 'image/png',
          width: null,
          height: null,
          sizeBytes: pngPage.length,
          size: expect.any(String),
        },
        {
          number: 2,
          fileName: '002.jpg',
          mediaType: 'image/jpeg',
          width: null,
          height: null,
          sizeBytes: COMIC_PAGE_JPEG.length,
          size: expect.any(String),
        },
      ]);

      const native = await komgaGet(`/komga/api/v1/books/${alphaTwo.bookId}/pages/2`, grouped);
      expect(native.statusCode).toBe(200);
      expect(native.headers['content-type']).toBe('image/jpeg');
      expect(native.rawPayload.subarray(0, 2)).toEqual(JPEG_SIGNATURE);
      expect(native.headers['cache-control']).toBe('private, max-age=86400');

      const cached = await ctx.app.inject({
        method: 'GET',
        url: `/komga/api/v1/books/${alphaTwo.bookId}/pages/2`,
        headers: { authorization: basicAuth(grouped.username, grouped.password), 'if-none-match': String(native.headers.etag) },
      });
      expect(cached.statusCode).toBe(304);

      const converted = await komgaGet(`/komga/api/v1/books/${alphaTwo.bookId}/pages/1?convert=jpeg`, grouped);
      expect(converted.statusCode).toBe(200);
      expect(converted.headers['content-type']).toBe('image/jpeg');
      expect(converted.rawPayload.subarray(0, 2)).toEqual(JPEG_SIGNATURE);
      expect(converted.headers.etag).not.toBe(native.headers.etag);

      const zeroBased = await komgaGet(`/komga/api/v1/books/${alphaTwo.bookId}/pages/0?zero_based=true`, grouped);
      expect(zeroBased.statusCode).toBe(200);
      expect(zeroBased.headers['content-type']).toBe('image/png');
      expect(zeroBased.rawPayload.subarray(0, 4)).toEqual(PNG_SIGNATURE);

      const samePng = await komgaGet(`/komga/api/v1/books/${alphaTwo.bookId}/pages/1?convert=png`, grouped);
      expect(samePng.statusCode).toBe(200);
      expect(samePng.headers['content-type']).toBe('image/png');

      expect((await komgaGet(`/komga/api/v1/books/${alphaTwo.bookId}/pages/0`, grouped)).statusCode).toBe(400);
      expect((await komgaGet(`/komga/api/v1/books/${alphaTwo.bookId}/pages/3`, grouped)).statusCode).toBe(400);
      expect((await komgaGet(`/komga/api/v1/books/${alphaTwo.bookId}/pages/1?convert=gif`, grouped)).statusCode).toBe(400);

      const epubPages = await komgaGet(`/komga/api/v1/books/${novelEpub.bookId}/pages`, flat);
      expect(epubPages.statusCode).toBe(200);
      expect(epubPages.json()).toEqual([]);
      expect((await komgaGet(`/komga/api/v1/books/${novelEpub.bookId}/pages/1`, flat)).statusCode).toBe(400);
    });

    it('serves the book thumbnail with an ETag', async () => {
      const response = await komgaGet(`/komga/api/v1/books/${alphaOne.bookId}/thumbnail`, grouped);
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('image/jpeg');
      expect(response.rawPayload.toString()).toBe(`thumb-${alphaOne.bookId}`);
      expect((await komgaGet(`/komga/api/v1/books/${alphaTwo.bookId}/thumbnail`, grouped)).statusCode).toBe(404);
    });

    it('downloads the file with Range support and a download filename', async () => {
      const { size } = await stat(alphaOne.absolutePath);

      const full = await komgaGet(`/komga/api/v1/books/${alphaOne.bookId}/file`, grouped);
      expect(full.statusCode).toBe(200);
      expect(full.headers['content-type']).toBe('application/vnd.comicbook+zip');
      expect(full.headers['accept-ranges']).toBe('bytes');
      expect(String(full.headers['content-disposition'])).toContain('attachment');
      expect(String(full.headers['content-disposition'])).not.toContain(comicLibrary.folderPath);
      expect(full.rawPayload.length).toBe(size);

      const partial = await ctx.app.inject({
        method: 'GET',
        url: `/komga/api/v1/books/${alphaOne.bookId}/file`,
        headers: { authorization: basicAuth(grouped.username, grouped.password), range: 'bytes=0-9' },
      });
      expect(partial.statusCode).toBe(206);
      expect(partial.headers['content-range']).toBe(`bytes 0-9/${size}`);
      expect(partial.rawPayload.length).toBe(10);
      expect(partial.rawPayload).toEqual(full.rawPayload.subarray(0, 10));

      const tail = await ctx.app.inject({
        method: 'GET',
        url: `/komga/api/v1/books/${alphaOne.bookId}/file`,
        headers: { authorization: basicAuth(grouped.username, grouped.password), range: `bytes=${size - 4}-` },
      });
      expect(tail.statusCode).toBe(206);
      expect(tail.headers['content-range']).toBe(`bytes ${size - 4}-${size - 1}/${size}`);
      expect(tail.rawPayload).toEqual(full.rawPayload.subarray(size - 4));

      const unsatisfiable = await ctx.app.inject({
        method: 'GET',
        url: `/komga/api/v1/books/${alphaOne.bookId}/file`,
        headers: { authorization: basicAuth(grouped.username, grouped.password), range: `bytes=${size + 10}-` },
      });
      expect(unsatisfiable.statusCode).toBe(416);
      expect(unsatisfiable.headers['content-range']).toBe(`bytes */${size}`);

      const pdf = await komgaGet(`/komga/api/v1/books/${manualPdf.bookId}/file`, flat);
      expect(pdf.statusCode).toBe(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
    });
  });

  describe('content filters', () => {
    it('hides an excluded book from series counts, series books, direct fetches, pages and referentials', async () => {
      const series = await komgaGet(`/komga/api/v1/series/${comicLibrary.libraryId}-s${seriesAId}`, filteredCredentials);
      expect(series.statusCode).toBe(200);
      expect(series.json()).toMatchObject({ booksCount: 3, metadata: { tags: [] } });

      const books = await komgaGet(`/komga/api/v1/series/${comicLibrary.libraryId}-s${seriesAId}/books`, filteredCredentials);
      expect((books.json() as KomgaPageBody<BookBody>).content.map((book) => book.name)).toEqual(['Alpha One', 'Crossover', 'Alpha Loose']);

      expect((await komgaGet(`/komga/api/v1/books/${alphaTwo.bookId}`, filteredCredentials)).statusCode).toBe(404);
      expect((await komgaGet(`/komga/api/v1/books/${alphaTwo.bookId}/pages`, filteredCredentials)).statusCode).toBe(404);
      expect((await komgaGet(`/komga/api/v1/books/${alphaTwo.bookId}/pages/1`, filteredCredentials)).statusCode).toBe(404);
      expect((await komgaGet(`/komga/api/v1/books/${alphaTwo.bookId}/file`, filteredCredentials)).statusCode).toBe(404);

      const tags = await komgaGet('/komga/api/v1/tags', filteredCredentials);
      expect(tags.json()).toEqual([]);
      const ownerTags = await komgaGet('/komga/api/v1/tags', grouped);
      expect(ownerTags.json()).toEqual([matureTag]);
    });
  });

  describe('referentials and empty lists', () => {
    it('returns scoped referential values and supported author roles', async () => {
      const authors = await komgaGet('/komga/api/v1/authors', grouped);
      expect(authors.json()).toEqual([{ name: writerName, role: 'writer' }]);
      const v2Authors = await komgaGet('/komga/api/v2/authors', grouped);
      expect(v2Authors.statusCode).toBe(200);
      expect(v2Authors.json()).toMatchObject({
        content: [{ name: writerName, role: 'writer' }],
        totalElements: 1,
        totalPages: 1,
        first: true,
        last: true,
      });
      expect(v2Authors.json().pageable).toMatchObject({ paged: true, pageNumber: 0, pageSize: 20 });
      expect((await komgaGet('/komga/api/v2/authors?role=penciller', grouped)).json()).toMatchObject({ content: [], totalElements: 0 });
      expect((await komgaGet('/komga/api/v2/tags?unpaged=true', grouped)).json()).toMatchObject({
        content: [matureTag],
        pageable: { unpaged: true },
      });
      expect(
        (await komgaGet(`/komga/api/v2/tags?search=${encodeURIComponent(matureTag.slice(0, 5).toUpperCase())}`, grouped)).json().content,
      ).toEqual([matureTag]);
      expect((await komgaGet('/komga/api/v2/tags?search=nothing-matches', grouped)).json()).toMatchObject({ content: [], empty: true });
      expect((await komgaGet('/komga/api/v2/genres?size=1', grouped)).json()).toMatchObject({ content: [], size: 1, totalElements: 0 });
      expect((await komgaGet('/komga/api/v2/age-ratings', grouped)).json()).toMatchObject({ content: [], totalElements: 0, empty: true });
      expect((await komgaGet('/komga/api/v2/sharing-labels', grouped)).json()).toMatchObject({ content: [], totalElements: 0 });
      expect((await komgaGet('/komga/api/v1/authors/names', grouped)).json()).toEqual([writerName]);
      expect((await komgaGet('/komga/api/v1/authors/roles', grouped)).json()).toEqual([
        'writer',
        'penciller',
        'inker',
        'colorist',
        'letterer',
        'cover',
      ]);
      expect((await komgaGet('/komga/api/v1/genres', grouped)).json()).toEqual([]);
      expect((await komgaGet('/komga/api/v1/tags/series', grouped)).json()).toEqual([matureTag]);
      expect((await komgaGet('/komga/api/v1/age-ratings', grouped)).json()).toEqual([]);
      expect((await komgaGet('/komga/api/v1/authors', peerCredentials)).json()).toEqual([]);
      expect((await komgaGet(`/komga/api/v1/authors?library_id=${hiddenLibrary.libraryId}`, grouped)).statusCode).toBe(403);
    });

    it('returns empty Spring pages for collections and read lists', async () => {
      for (const path of ['/komga/api/v1/collections?unpaged=true', '/komga/api/v1/readlists']) {
        const response = await komgaGet(path, grouped);
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ content: [], totalElements: 0, totalPages: 0, empty: true, first: true, last: true });
      }
    });
  });

  describe('account management', () => {
    it('requires komga_access to manage accounts', async () => {
      const denied = await ctx.app.inject({ method: 'GET', url: '/api/v1/komga-users', headers: authHeader(noPermissionUser.accessToken) });
      expect(denied.statusCode).toBe(403);

      const deniedStatus = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/komga-api/status',
        headers: authHeader(noPermissionUser.accessToken),
      });
      expect(deniedStatus.statusCode).toBe(403);

      const status = await ctx.app.inject({ method: 'GET', url: '/api/v1/komga-api/status', headers: authHeader(owner.accessToken) });
      expect(status.statusCode).toBe(200);
      expect(status.json()).toEqual({ enabled: true });

      const unauthenticated = await ctx.app.inject({ method: 'GET', url: '/api/v1/komga-users' });
      expect(unauthenticated.statusCode).toBe(401);
    });

    it('creates, updates, lists and deletes accounts for the current user only', async () => {
      const username = `mihon-${randomUUID().slice(0, 8)}`;
      const created = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/komga-users',
        headers: authHeader(owner.accessToken),
        payload: { username, password: 'MihonPassword123' },
      });
      expect(created.statusCode).toBe(201);
      expect(created.json()).toEqual({
        id: expect.any(Number),
        userId: owner.userId,
        username,
        groupUnknownSeries: true,
        includeNonComicBooks: false,
        createdAt: expect.any(String),
      });
      expect(created.json()).not.toHaveProperty('passwordHash');
      const accountId = created.json().id as number;

      const duplicate = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/komga-users',
        headers: authHeader(owner.accessToken),
        payload: { username: username.toUpperCase(), password: 'MihonPassword123' },
      });
      expect(duplicate.statusCode).toBe(409);

      const shortPassword = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/komga-users',
        headers: authHeader(owner.accessToken),
        payload: { username: `x-${randomUUID().slice(0, 8)}`, password: 'short' },
      });
      expect(shortPassword.statusCode).toBe(400);

      expect((await komgaGet('/komga/api/v1/libraries', { username, password: 'MihonPassword123' })).statusCode).toBe(200);

      const updated = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/komga-users/${accountId}`,
        headers: authHeader(owner.accessToken),
        payload: { includeNonComicBooks: true },
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json()).toMatchObject({ id: accountId, groupUnknownSeries: true, includeNonComicBooks: true });

      const emptyUpdate = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/komga-users/${accountId}`,
        headers: authHeader(owner.accessToken),
        payload: {},
      });
      expect(emptyUpdate.statusCode).toBe(400);

      const foreignUpdate = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/komga-users/${accountId}`,
        headers: authHeader(peer.accessToken),
        payload: { groupUnknownSeries: false },
      });
      expect(foreignUpdate.statusCode).toBe(403);

      const listed = await ctx.app.inject({ method: 'GET', url: '/api/v1/komga-users', headers: authHeader(owner.accessToken) });
      expect(listed.statusCode).toBe(200);
      expect((listed.json() as Array<{ id: number }>).map((row) => row.id)).toContain(accountId);
      const peerList = await ctx.app.inject({ method: 'GET', url: '/api/v1/komga-users', headers: authHeader(peer.accessToken) });
      expect((peerList.json() as Array<{ id: number }>).map((row) => row.id)).not.toContain(accountId);

      const foreignDelete = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/komga-users/${accountId}`,
        headers: authHeader(peer.accessToken),
      });
      expect(foreignDelete.statusCode).toBe(403);

      const deleted = await ctx.app.inject({ method: 'DELETE', url: `/api/v1/komga-users/${accountId}`, headers: authHeader(owner.accessToken) });
      expect(deleted.statusCode).toBe(204);
      expect((await komgaGet('/komga/api/v1/libraries', { username, password: 'MihonPassword123' })).statusCode).toBe(401);
    });
  });

  describe('OPDS feed', () => {
    it('challenges the OPDS catalog without credentials', async () => {
      const response = await komgaGet('/komga/opds/v1.2/catalog');
      expect(response.statusCode).toBe(401);
      expect(response.headers['www-authenticate']).toBe('Basic realm="bookorbit Komga"');
    });

    it('serves the catalog from the bare /opds address clients are given', async () => {
      const response = await komgaGet('/komga/opds', grouped);
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('kind=navigation');
      expect(response.body).toContain('<name>Komga</name>');
      expect(response.body).toContain('href="/komga/opds/v1.2/series"');
    });

    it('lists only libraries the account can reach', async () => {
      const response = await komgaGet('/komga/opds/v1.2/libraries', grouped);
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain(comicLibraryName);
      expect(response.body).not.toContain(hiddenLibraryName);
      expect(response.body).toContain(`href="/komga/opds/v1.2/libraries/${comicLibrary.libraryId}"`);
    });

    it('routes series/latest ahead of the series id parameter', async () => {
      const response = await komgaGet('/komga/opds/v1.2/series/latest', grouped);
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('<title>Latest series</title>');
    });

    it('filters the series feed by search term', async () => {
      const response = await komgaGet(`/komga/opds/v1.2/series?search=${encodeURIComponent(seriesBName)}`, grouped);
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain(seriesBName);
      expect(response.body).not.toContain(seriesAName);
    });

    it('includes page-stream links for books in a series', async () => {
      const seriesId = `${comicLibrary.libraryId}-s${seriesAId}`;
      const response = await komgaGet(`/komga/opds/v1.2/series/${seriesId}`, grouped);
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('kind=acquisition');
      expect(response.body).toContain(`<id>${alphaOne.bookId}</id>`);

      const streamHref = `/komga/opds/v1.2/books/${alphaOne.bookId}/pages/{pageNumber}?convert=jpeg`;
      expect(response.body).toContain(`href="${streamHref.replace('&', '&amp;')}"`);
      expect(response.body).toContain('pse:count="2"');
    });

    it('maps OPDS page 0 to REST page 1', async () => {
      const first = await komgaGet(`/komga/opds/v1.2/books/${alphaOne.bookId}/pages/0`, grouped);
      const rest = await komgaGet(`/komga/api/v1/books/${alphaOne.bookId}/pages/1`, grouped);
      expect(first.statusCode).toBe(200);
      expect(rest.statusCode).toBe(200);
      expect(first.rawPayload.equals(rest.rawPayload)).toBe(true);

      const last = await komgaGet(`/komga/opds/v1.2/books/${alphaOne.bookId}/pages/1`, grouped);
      expect(last.statusCode).toBe(200);

      const beyond = await komgaGet(`/komga/opds/v1.2/books/${alphaOne.bookId}/pages/2`, grouped);
      expect(beyond.statusCode).toBe(400);
    });

    it('serves book thumbnails and downloads from the feed links', async () => {
      const thumbnail = await komgaGet(`/komga/opds/v1.2/books/${alphaOne.bookId}/thumbnail/small`, grouped);
      expect(thumbnail.statusCode).toBe(200);
      expect(thumbnail.headers['content-type']).toBe('image/jpeg');

      const download = await komgaGet(`/komga/opds/v1.2/books/${alphaOne.bookId}/file/alpha-one.cbz`, grouped);
      expect(download.statusCode).toBe(200);
      expect(download.headers['content-type']).toContain('application/vnd.comicbook+zip');
    });

    it('hides books filtered out for the account', async () => {
      const seriesId = `${comicLibrary.libraryId}-s${seriesAId}`;
      const response = await komgaGet(`/komga/opds/v1.2/series/${seriesId}`, filteredCredentials);
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain(`<id>${alphaTwo.bookId}</id>`);
    });

    it('refuses a library the account cannot reach', async () => {
      expect((await komgaGet(`/komga/opds/v1.2/libraries/${hiddenLibrary.libraryId}`, grouped)).statusCode).toBe(403);
    });

    it('serves the OpenSearch description that drives client search', async () => {
      const response = await komgaGet('/komga/opds/v1.2/search', grouped);
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('opensearchdescription');
      expect(response.body).toContain('template="/komga/opds/v1.2/series?search={searchTerms}"');
    });

    it('refuses the whole feed while the Komga API is disabled', async () => {
      await setKomgaApiEnabled(false);
      try {
        const response = await komgaGet('/komga/opds/v1.2/catalog', grouped);
        expect(response.statusCode).toBe(403);
      } finally {
        await setKomgaApiEnabled(true);
      }
    });
  });

  describe('read progress', () => {
    const seriesAPath = () => `/komga/api/v1/series/${comicLibrary.libraryId}-s${seriesAId}`;
    const trackerV2 = () => `/komga/api/v2/series/${comicLibrary.libraryId}-s${seriesAId}/read-progress/tachiyomi`;
    const trackerV1 = () => `${seriesAPath()}/read-progress/tachiyomi`;

    it('records a page from a Komga client and shows it to the web reader and the OPDS feed', async () => {
      const written = await komgaSend('PATCH', `/komga/api/v1/books/${alphaOne.bookId}/read-progress`, grouped, { page: 1 });
      expect(written.statusCode).toBe(204);

      const book = (await komgaGet(`/komga/api/v1/books/${alphaOne.bookId}`, grouped)).json() as BookBody;
      expect(book.readProgress).toMatchObject({ page: 1, completed: false, deviceId: '', deviceName: 'BookOrbit' });
      expect(book.readProgress?.readDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

      const webProgress = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/books/files/${alphaOne.bookFileId}/progress`,
        headers: authHeader(owner.accessToken),
      });
      expect(webProgress.json()).toMatchObject({ pageNumber: 1, percentage: 50 });

      const feed = await komgaGet(`/komga/opds/v1.2/series/${comicLibrary.libraryId}-s${seriesAId}`, grouped);
      expect(feed.body).toContain('pse:lastRead="1"');
      expect(feed.body).toMatch(/pse:lastReadDate="\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z"/);

      const series = (await komgaGet(seriesAPath(), grouped)).json() as SeriesBody & {
        booksReadCount: number;
        booksInProgressCount: number;
        booksUnreadCount: number;
      };
      expect(series).toMatchObject({ booksCount: 4, booksReadCount: 0, booksInProgressCount: 1, booksUnreadCount: 3 });

      const inProgress = (await komgaGet('/komga/api/v1/series?read_status=IN_PROGRESS', grouped)).json() as KomgaPageBody<SeriesBody>;
      expect(inProgress.content.map((entry) => entry.id)).toEqual([`${comicLibrary.libraryId}-s${seriesAId}`]);
      const read = (await komgaGet('/komga/api/v1/series?read_status=READ', grouped)).json() as KomgaPageBody<SeriesBody>;
      expect(read.content).toEqual([]);
      const unreadSeries = (await komgaGet('/komga/api/v1/series?read_status=UNREAD', grouped)).json() as KomgaPageBody<SeriesBody>;
      expect(unreadSeries.content.map((entry) => entry.id)).not.toContain(`${comicLibrary.libraryId}-s${seriesAId}`);

      const inProgressBooks = (await komgaGet(`${seriesAPath()}/books?read_status=IN_PROGRESS`, grouped)).json() as KomgaPageBody<BookBody>;
      expect(inProgressBooks.content.map((entry) => entry.name)).toEqual(['Alpha One']);
      const unreadBooks = (await komgaGet(`${seriesAPath()}/books?read_status=UNREAD`, grouped)).json() as KomgaPageBody<BookBody>;
      expect(unreadBooks.content.map((entry) => entry.name)).toEqual(['Alpha Two', 'Crossover', 'Alpha Loose']);

      const otherUser = (await komgaGet(`/komga/api/v1/books/${alphaOne.bookId}`, filteredCredentials)).json() as BookBody;
      expect(otherUser.readProgress).toBeNull();
    });

    it('marks the last page as completed and records a komga reading attempt', async () => {
      expect((await komgaSend('PATCH', `/komga/api/v1/books/${alphaOne.bookId}/read-progress`, grouped, { page: 2 })).statusCode).toBe(204);

      const book = (await komgaGet(`/komga/api/v1/books/${alphaOne.bookId}`, grouped)).json() as BookBody;
      expect(book.readProgress).toMatchObject({ page: 2, completed: true });

      const [status] = await ctx.db
        .select({ status: schema.userBookStatus.status })
        .from(schema.userBookStatus)
        .where(and(eq(schema.userBookStatus.userId, owner.userId), eq(schema.userBookStatus.bookId, alphaOne.bookId)));
      expect(status?.status).toBe('read');

      const attempts = await ctx.db
        .select({ origin: schema.readingAttempts.origin, outcome: schema.readingAttempts.outcome })
        .from(schema.readingAttempts)
        .where(and(eq(schema.readingAttempts.userId, owner.userId), eq(schema.readingAttempts.bookId, alphaOne.bookId)));
      expect(attempts).toEqual([{ origin: 'komga', outcome: 'completed' }]);

      expect((await komgaGet(trackerV2(), grouped)).json()).toEqual({
        booksCount: 4,
        booksReadCount: 1,
        booksUnreadCount: 3,
        booksInProgressCount: 0,
        lastReadContinuousNumberSort: 1,
        maxNumberSort: 4,
      });
      expect((await komgaGet(trackerV1(), grouped)).json()).toEqual({
        booksCount: 4,
        booksReadCount: 1,
        booksUnreadCount: 3,
        booksInProgressCount: 0,
        lastReadContinuousIndex: 1,
      });
    });

    it('advances the Tachiyomi tracker without ever marking books unread', async () => {
      expect((await komgaSend('PUT', trackerV2(), grouped, { lastBookNumberSortRead: 2 })).statusCode).toBe(204);
      expect((await komgaGet(trackerV2(), grouped)).json()).toMatchObject({ booksReadCount: 2, lastReadContinuousNumberSort: 2 });

      expect((await komgaSend('PUT', trackerV2(), grouped, { lastBookNumberSortRead: 1 })).statusCode).toBe(204);
      expect((await komgaGet(trackerV2(), grouped)).json()).toMatchObject({ booksReadCount: 2, lastReadContinuousNumberSort: 2 });

      expect((await komgaSend('PUT', trackerV1(), grouped, { lastBookRead: 3 })).statusCode).toBe(204);
      expect((await komgaGet(trackerV1(), grouped)).json()).toMatchObject({ booksReadCount: 3, lastReadContinuousIndex: 3 });

      const seriesB = (await komgaGet(`/komga/api/v1/series/${comicLibrary.libraryId}-s${seriesBId}`, grouped)).json() as { booksReadCount: number };
      expect(seriesB.booksReadCount).toBe(1);
    });

    it('puts the next unread book on deck and serves the recency lists', async () => {
      const onDeck = (await komgaGet('/komga/api/v1/books/ondeck', grouped)).json() as KomgaPageBody<BookBody>;
      expect(onDeck.totalElements).toBe(1);
      expect(onDeck.content).toEqual([
        expect.objectContaining({ id: String(alphaLoose.bookId), seriesId: `${comicLibrary.libraryId}-s${seriesAId}`, readProgress: null }),
      ]);

      const latestBooks = (await komgaGet('/komga/api/v1/books/latest?size=2', grouped)).json() as KomgaPageBody<BookBody>;
      expect(latestBooks.totalElements).toBe(5);
      expect(latestBooks.content).toHaveLength(2);
      const allLatest = (await komgaGet('/komga/api/v1/books/latest?unpaged=true', grouped)).json() as KomgaPageBody<BookBody>;
      expect(allLatest.pageable).toMatchObject({ paged: false, unpaged: true });
      expect(allLatest.content).toHaveLength(5);
      const unpagedSeries = (await komgaGet('/komga/api/v1/series/latest?unpaged=true', grouped)).json() as KomgaPageBody<SeriesBody>;
      expect(unpagedSeries.pageable).toMatchObject({ paged: false, unpaged: true });
      expect(unpagedSeries.content).toHaveLength(unpagedSeries.totalElements);

      const recent = new Map<string, string[]>();
      for (const path of ['new', 'updated', 'latest']) {
        const response = await komgaGet(`/komga/api/v1/series/${path}?library_id=${comicLibrary.libraryId}`, grouped);
        expect(response.statusCode).toBe(200);
        const page = response.json() as KomgaPageBody<SeriesBody>;
        expect(page.content.length).toBe(page.totalElements);
        recent.set(
          path,
          page.content.map((entry) => entry.id),
        );
      }
      const allSeries = [`${comicLibrary.libraryId}-s${seriesAId}`, `${comicLibrary.libraryId}-s${seriesBId}`, `${comicLibrary.libraryId}-u`];
      expect([...recent.get('new')!].sort()).toEqual(allSeries.sort());
      expect([...recent.get('latest')!].sort()).toEqual(allSeries.sort());
      expect(recent.get('updated')!.every((id) => allSeries.includes(id))).toBe(true);
      expect((await komgaGet(`/komga/api/v1/series/new?library_id=${hiddenLibrary.libraryId}`, grouped)).statusCode).toBe(403);
    });

    it('reads web reader progress back through Komga and breaks the continuous run', async () => {
      const saved = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/books/files/${alphaLoose.bookFileId}/progress`,
        headers: authHeader(owner.accessToken),
        payload: { pageNumber: 1, percentage: 50 },
      });
      expect(saved.statusCode).toBe(201);

      const book = (await komgaGet(`/komga/api/v1/books/${alphaLoose.bookId}`, grouped)).json() as BookBody;
      expect(book.readProgress).toMatchObject({ page: 1, completed: false });
      expect((await komgaGet(trackerV2(), grouped)).json()).toMatchObject({
        booksReadCount: 3,
        booksInProgressCount: 1,
        lastReadContinuousNumberSort: 3,
      });

      const onDeck = (await komgaGet('/komga/api/v1/books/ondeck', grouped)).json() as KomgaPageBody<BookBody>;
      expect(onDeck.totalElements).toBe(0);
    });

    it('clears a book from a Komga client and resets its automatic status', async () => {
      expect((await komgaSend('DELETE', `/komga/api/v1/books/${alphaOne.bookId}/read-progress`, grouped)).statusCode).toBe(204);

      const webProgress = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/books/files/${alphaOne.bookFileId}/progress`,
        headers: authHeader(owner.accessToken),
      });
      expect(webProgress.json()).toMatchObject({ pageNumber: null, percentage: 0 });

      const book = (await komgaGet(`/komga/api/v1/books/${alphaOne.bookId}`, grouped)).json() as BookBody;
      expect(book.readProgress).toBeNull();

      const [status] = await ctx.db
        .select({ status: schema.userBookStatus.status })
        .from(schema.userBookStatus)
        .where(and(eq(schema.userBookStatus.userId, owner.userId), eq(schema.userBookStatus.bookId, alphaOne.bookId)));
      expect(status?.status).toBe('unread');
      expect((await komgaGet(trackerV2(), grouped)).json()).toMatchObject({ booksReadCount: 2, lastReadContinuousNumberSort: 0 });
    });

    it('marks and unmarks a whole series', async () => {
      expect((await komgaSend('POST', `${seriesAPath()}/read-progress`, grouped)).statusCode).toBe(204);
      expect((await komgaGet(trackerV2(), grouped)).json()).toMatchObject({
        booksReadCount: 4,
        booksInProgressCount: 0,
        lastReadContinuousNumberSort: 4,
      });

      expect((await komgaSend('DELETE', `${seriesAPath()}/read-progress`, grouped)).statusCode).toBe(204);
      expect((await komgaGet(trackerV2(), grouped)).json()).toMatchObject({ booksReadCount: 0, booksInProgressCount: 0, booksUnreadCount: 4 });

      const webProgress = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/books/files/${alphaTwo.bookFileId}/progress`,
        headers: authHeader(owner.accessToken),
      });
      expect(webProgress.json()).toMatchObject({ pageNumber: null, percentage: 0 });
      const books = (await komgaGet(`${seriesAPath()}/books`, grouped)).json() as KomgaPageBody<BookBody>;
      expect(books.content.every((entry) => entry.readProgress === null)).toBe(true);
    });

    it('rejects invalid writes, hidden books and pageless files', async () => {
      const alphaOnePath = `/komga/api/v1/books/${alphaOne.bookId}/read-progress`;
      expect((await komgaSend('PATCH', alphaOnePath, grouped, { page: 0 })).statusCode).toBe(400);
      expect((await komgaSend('PATCH', alphaOnePath, grouped, { page: 3 })).statusCode).toBe(400);
      expect((await komgaSend('PATCH', alphaOnePath, grouped, {})).statusCode).toBe(400);
      expect((await komgaSend('PATCH', alphaOnePath, grouped, { completed: false })).statusCode).toBe(400);
      expect((await komgaSend('PUT', trackerV2(), grouped, { lastBookNumberSortRead: 'two' })).statusCode).toBe(400);

      expect((await komgaSend('PATCH', `/komga/api/v1/books/${hiddenComic.bookId}/read-progress`, grouped, { page: 1 })).statusCode).toBe(404);
      expect((await komgaSend('DELETE', `/komga/api/v1/books/${hiddenComic.bookId}/read-progress`, grouped)).statusCode).toBe(404);
      expect((await komgaSend('PATCH', `/komga/api/v1/books/${alphaTwo.bookId}/read-progress`, filteredCredentials, { page: 1 })).statusCode).toBe(
        404,
      );
      expect((await komgaSend('PATCH', alphaOnePath, peerCredentials, { page: 1 })).statusCode).toBe(404);
      expect((await komgaSend('POST', `/komga/api/v1/series/${comicLibrary.libraryId}-s999999/read-progress`, grouped)).statusCode).toBe(404);
      expect((await komgaGet(`/komga/api/v2/series/${hiddenLibrary.libraryId}-u/read-progress/tachiyomi`, grouped)).statusCode).toBe(404);

      const pdfPath = `/komga/api/v1/books/${manualPdf.bookId}/read-progress`;
      expect((await komgaSend('PATCH', pdfPath, flat, { page: 1 })).statusCode).toBe(400);
      expect((await komgaSend('PATCH', pdfPath, flat, { completed: true })).statusCode).toBe(204);
      const pdf = (await komgaGet(`/komga/api/v1/books/${manualPdf.bookId}`, flat)).json() as BookBody;
      expect(pdf.readProgress).toMatchObject({ page: 0, completed: true });

      const readOnly = (await komgaGet(`/komga/api/v1/books/${alphaOne.bookId}`, grouped)).json() as BookBody;
      expect(readOnly.readProgress).toBeNull();
    });
  });

  describe('search and lists', () => {
    const seriesAKey = () => `${comicLibrary.libraryId}-s${seriesAId}`;
    const seriesBKey = () => `${comicLibrary.libraryId}-s${seriesBId}`;

    async function searchSeries(credentials: Credentials, body: Record<string, unknown>, query = '') {
      const response = await komgaSend('POST', `/komga/api/v1/series/list${query}`, credentials, body);
      expect(response.statusCode).toBe(200);
      return response.json() as KomgaPageBody<SeriesBody>;
    }

    async function searchBooks(credentials: Credentials, body: Record<string, unknown>, query = '') {
      const response = await komgaSend('POST', `/komga/api/v1/books/list${query}`, credentials, body);
      expect(response.statusCode).toBe(200);
      return response.json() as KomgaPageBody<BookBody>;
    }

    const seriesNames = (page: KomgaPageBody<SeriesBody>) => page.content.map((series) => series.name);
    const bookNames = (page: KomgaPageBody<BookBody>) => page.content.map((book) => book.name);

    it('lists series through the condition tree with full text search, paging and sorting', async () => {
      expect(seriesNames(await searchSeries(grouped, {}))).toEqual([seriesAName, seriesBName, 'Unknown Series']);

      const libraryId = String(comicLibrary.libraryId);
      const byTag = await searchSeries(grouped, {
        condition: { allOf: [{ libraryId: { operator: 'is', value: libraryId } }, { tag: { operator: 'is', value: matureTag.toUpperCase() } }] },
      });
      expect(seriesNames(byTag)).toEqual([seriesAName]);

      const either = await searchSeries(
        grouped,
        {
          condition: { anyOf: [{ title: { operator: 'contains', value: 'series b' } }, { titleSort: { operator: 'beginsWith', value: 'unknown' } }] },
        },
        '?sort=metadata.titleSort,desc',
      );
      expect(seriesNames(either)).toEqual(['Unknown Series', seriesBName]);

      const fullText = await searchSeries(grouped, { fullTextSearch: seriesAName.slice(0, 8).toUpperCase() });
      expect(seriesNames(fullText)).toEqual([seriesAName]);

      const paged = await searchSeries(grouped, {}, '?page=1&size=1');
      expect(paged).toMatchObject({ totalElements: 3, totalPages: 3, number: 1, size: 1, first: false, last: false });
      expect(seriesNames(paged)).toEqual([seriesBName]);

      expect(seriesNames(await searchSeries(flat, { condition: { oneShot: { operator: 'isTrue' } } }))).toEqual(['Manual', 'Novel', 'Standalone']);
      expect(seriesNames(await searchSeries(flat, { condition: { oneShot: { operator: 'isFalse' } } }))).toEqual([seriesAName, seriesBName]);
      expect(
        seriesNames(
          await searchSeries(grouped, { condition: { author: { operator: 'is', value: { name: writerName.toLowerCase(), role: 'writer' } } } }),
        ),
      ).toEqual([seriesAName]);
      expect(seriesNames(await searchSeries(grouped, { condition: { author: { operator: 'is', value: { role: 'penciller' } } } }))).toEqual([]);
      expect(seriesNames(await searchSeries(grouped, { condition: { tag: { operator: 'isNotNull' } } }))).toEqual([seriesAName]);
      expect(seriesNames(await searchSeries(grouped, { condition: { tag: { operator: 'isNull' } } }))).toEqual([seriesBName, 'Unknown Series']);
      expect(seriesNames(await searchSeries(grouped, { condition: { genre: { operator: 'isNull' } } }))).toHaveLength(3);
      expect(seriesNames(await searchSeries(grouped, { condition: { publisher: { operator: 'is', value: 'Image' } } }))).toEqual([]);
      expect(seriesNames(await searchSeries(grouped, { condition: { language: { operator: 'isNot', value: 'fr' } } }))).toHaveLength(3);
      expect(seriesNames(await searchSeries(grouped, { condition: { complete: { operator: 'isTrue' } } }))).toEqual([]);
      expect(seriesNames(await searchSeries(grouped, { condition: { seriesStatus: { operator: 'is', value: 'ONGOING' } } }))).toHaveLength(3);
      expect(seriesNames(await searchSeries(grouped, { condition: { releaseDate: { operator: 'isNull' } } }))).toEqual([
        seriesBName,
        'Unknown Series',
      ]);
      expect(seriesNames(await searchSeries(grouped, { condition: { releaseDate: { operator: 'isNotNull' } } }))).toEqual([seriesAName]);
      expect(
        seriesNames(await searchSeries(grouped, { condition: { releaseDate: { operator: 'before', dateTime: '2013-01-01T00:00:00Z' } } })),
      ).toEqual([seriesAName]);
      expect(seriesNames(await searchSeries(grouped, { condition: { releaseDate: { operator: 'after', dateTime: '2013-01-01' } } }))).toEqual([]);
      expect(seriesNames(await searchSeries(grouped, { condition: { readStatus: { operator: 'is', value: 'UNREAD' } } }))).toHaveLength(3);
      expect(seriesNames(await searchSeries(grouped, { condition: { deleted: { operator: 'isTrue' } } }))).toEqual([]);
      expect(
        seriesNames(await searchSeries(grouped, { condition: { libraryId: { operator: 'is', value: String(hiddenLibrary.libraryId) } } })),
      ).toEqual([]);
      expect(seriesNames(await searchSeries(peerCredentials, {}))).toEqual([]);
    });

    it('lists books through the condition tree in the context of a required series', async () => {
      const bySeriesA = { condition: { seriesId: { operator: 'is', value: seriesAKey() } } };
      const inSeriesA = await searchBooks(grouped, bySeriesA);
      expect(bookNames(inSeriesA)).toEqual(['Alpha Loose', 'Alpha One', 'Alpha Two', 'Crossover']);
      for (const book of inSeriesA.content) expect(book.seriesId).toBe(seriesAKey());
      expect(inSeriesA.content.find((book) => book.name === 'Crossover')?.metadata).toMatchObject({ number: '3', numberSort: 3 });

      expect(bookNames(await searchBooks(grouped, bySeriesA, '?sort=metadata.numberSort,asc'))).toEqual([
        'Alpha One',
        'Alpha Two',
        'Crossover',
        'Alpha Loose',
      ]);
      expect(bookNames(await searchBooks(grouped, bySeriesA, '?sort=metadata.numberSort,desc'))).toEqual([
        'Crossover',
        'Alpha Two',
        'Alpha One',
        'Alpha Loose',
      ]);
      const secondChapterPage = await searchBooks(grouped, bySeriesA, '?sort=metadata.numberSort,asc&size=2&page=1');
      expect(bookNames(secondChapterPage)).toEqual(['Crossover', 'Alpha Loose']);
      expect(secondChapterPage).toMatchObject({ totalElements: 4, totalPages: 2, last: true });

      const searchedInA = await searchBooks(grouped, { ...bySeriesA, fullTextSearch: 'alpha' });
      expect(bookNames(searchedInA)).toEqual(['Alpha Loose', 'Alpha One', 'Alpha Two']);
      expect(searchedInA.totalElements).toBe(3);
      expect(
        bookNames(await searchBooks(grouped, { condition: { allOf: [bySeriesA.condition, { title: { operator: 'contains', value: 'two' } }] } })),
      ).toEqual(['Alpha Two']);
      expect(
        bookNames(await searchBooks(grouped, { condition: { allOf: [bySeriesA.condition, { releaseDate: { operator: 'isNotNull' } }] } })),
      ).toEqual(['Alpha One']);
      expect(bookNames(await searchBooks(grouped, bySeriesA, '?sort=metadata.releaseDate,asc&sort=metadata.title,desc'))).toEqual([
        'Alpha One',
        'Crossover',
        'Alpha Two',
        'Alpha Loose',
      ]);
      expect(bookNames(await searchBooks(grouped, bySeriesA, '?sort=metadata.releaseDate,desc'))).toEqual([
        'Alpha One',
        'Alpha Loose',
        'Alpha Two',
        'Crossover',
      ]);

      const inSeriesB = await searchBooks(grouped, { condition: { seriesId: { operator: 'is', value: seriesBKey() } } });
      expect(inSeriesB.content).toEqual([
        expect.objectContaining({ name: 'Crossover', seriesId: seriesBKey(), metadata: expect.objectContaining({ number: '1' }) }),
      ]);

      const unknownBucket = await searchBooks(grouped, { condition: { seriesId: { operator: 'is', value: `${comicLibrary.libraryId}-u` } } });
      expect(unknownBucket.content).toEqual([expect.objectContaining({ name: 'Standalone', seriesTitle: 'Unknown Series' })]);
      const oneshot = await searchBooks(flat, {
        condition: { seriesId: { operator: 'is', value: `${comicLibrary.libraryId}-b${standalone.bookId}` } },
      });
      expect(oneshot.content).toEqual([expect.objectContaining({ name: 'Standalone', oneshot: true })]);
      expect(bookNames(await searchBooks(grouped, { condition: { seriesId: { operator: 'isNot', value: seriesAKey() } } }))).toEqual(['Standalone']);

      expect(bookNames(await searchBooks(grouped, { condition: { title: { operator: 'beginsWith', value: 'alpha' } } }))).toEqual([
        'Alpha Loose',
        'Alpha One',
        'Alpha Two',
      ]);
      expect(bookNames(await searchBooks(grouped, { condition: { title: { operator: 'doesNotContain', value: 'alpha' } } }))).toEqual([
        'Crossover',
        'Standalone',
      ]);
      expect(bookNames(await searchBooks(grouped, { condition: { tag: { operator: 'is', value: matureTag } } }))).toEqual(['Alpha Two']);
      expect(bookNames(await searchBooks(grouped, { condition: { tag: { operator: 'isNull' } } }))).toEqual([
        'Alpha Loose',
        'Alpha One',
        'Crossover',
        'Standalone',
      ]);
      expect(bookNames(await searchBooks(grouped, { condition: { author: { operator: 'is', value: { name: writerName } } } }))).toEqual([
        'Alpha One',
      ]);
      expect(bookNames(await searchBooks(grouped, { condition: { author: { operator: 'isNot', value: { name: writerName } } } }))).toHaveLength(4);
      expect(bookNames(await searchBooks(grouped, { condition: { releaseDate: { operator: 'isNull' } } }))).toEqual([
        'Alpha Loose',
        'Alpha Two',
        'Crossover',
        'Standalone',
      ]);
      expect(bookNames(await searchBooks(grouped, { condition: { releaseDate: { operator: 'after', dateTime: '2000-01-01T00:00:00Z' } } }))).toEqual([
        'Alpha One',
      ]);
      expect(bookNames(await searchBooks(grouped, { condition: { releaseDate: { operator: 'isInTheLast', duration: 'P30D' } } }))).toEqual([]);
      expect(bookNames(await searchBooks(grouped, { condition: { releaseDate: { operator: 'isNotInTheLast', duration: 'P30D' } } }))).toEqual([
        'Alpha One',
      ]);

      expect(bookNames(await searchBooks(flat, { condition: { mediaProfile: { operator: 'is', value: 'PDF' } } }))).toEqual(['Manual']);
      expect(bookNames(await searchBooks(flat, { condition: { mediaProfile: { operator: 'is', value: 'EPUB' } } }))).toEqual(['Novel']);
      expect(bookNames(await searchBooks(flat, { condition: { mediaStatus: { operator: 'is', value: 'UNSUPPORTED' } } }))).toEqual(['Manual']);
      expect(bookNames(await searchBooks(flat, { condition: { mediaStatus: { operator: 'isNot', value: 'READY' } } }))).toEqual(['Manual']);
      expect(bookNames(await searchBooks(flat, { condition: { oneShot: { operator: 'isTrue' } } }))).toEqual(['Manual', 'Novel', 'Standalone']);
      expect(bookNames(await searchBooks(grouped, { condition: { mediaProfile: { operator: 'is', value: 'PDF' } } }))).toEqual([]);
      expect(bookNames(await searchBooks(grouped, { condition: { mediaStatus: { operator: 'is', value: 'ERROR' } } }))).toEqual([]);
      expect(bookNames(await searchBooks(grouped, { condition: { oneShot: { operator: 'isTrue' } } }))).toEqual([]);
      expect(bookNames(await searchBooks(grouped, { condition: { libraryId: { operator: 'is', value: String(hiddenLibrary.libraryId) } } }))).toEqual(
        [],
      );

      expect(bookNames(await searchBooks(grouped, { fullTextSearch: 'crossover' }))).toEqual(['Crossover']);
      expect(bookNames(await searchBooks(grouped, { fullTextSearch: writerName.split(' ')[0] }))).toEqual(['Alpha One']);

      const paged = await searchBooks(grouped, {}, '?page=1&size=2&sort=createdDate,asc');
      expect(paged).toMatchObject({ totalElements: 5, totalPages: 3, number: 1, size: 2, numberOfElements: 2 });
    });

    it("filters and sorts search results by the caller's read state", async () => {
      expect((await komgaSend('PATCH', `/komga/api/v1/books/${alphaOne.bookId}/read-progress`, grouped, { page: 1 })).statusCode).toBe(204);
      const markedRead = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/books/${alphaTwo.bookId}/status`,
        headers: authHeader(owner.accessToken),
        payload: { status: 'read' },
      });
      expect(markedRead.statusCode).toBe(200);
      try {
        expect(bookNames(await searchBooks(grouped, { condition: { readStatus: { operator: 'is', value: 'IN_PROGRESS' } } }))).toEqual(['Alpha One']);
        expect(bookNames(await searchBooks(grouped, { condition: { readStatus: { operator: 'is', value: 'READ' } } }))).toEqual(['Alpha Two']);
        expect(bookNames(await searchBooks(grouped, { condition: { readStatus: { operator: 'isNot', value: 'UNREAD' } } }))).toEqual([
          'Alpha One',
          'Alpha Two',
        ]);
        expect(bookNames(await searchBooks(grouped, { condition: { readStatus: { operator: 'is', value: 'UNREAD' } } }))).toHaveLength(3);

        const byReadDate = await searchBooks(grouped, {}, '?sort=readProgress.readDate,desc');
        const dated = byReadDate.content.filter((book) => book.readProgress !== null);
        expect(dated.map((book) => book.name).sort()).toEqual(['Alpha One', 'Alpha Two']);
        expect(byReadDate.content.slice(0, 2)).toEqual(dated);
        const readDates = dated.map((book) => book.readProgress!.readDate);
        expect(readDates).toEqual([...readDates].sort().reverse());

        const seriesByReadDate = await searchBooks(
          grouped,
          { condition: { seriesId: { operator: 'is', value: seriesAKey() } } },
          '?sort=readProgress.readDate,desc',
        );
        expect(seriesByReadDate.content.slice(0, 2)).toEqual(dated);
        expect(seriesByReadDate.content.slice(2).every((book) => book.readProgress === null)).toBe(true);
        expect(seriesNames(await searchSeries(grouped, { condition: { readStatus: { operator: 'is', value: 'IN_PROGRESS' } } }))).toEqual([
          seriesAName,
        ]);
        expect(seriesNames(await searchSeries(grouped, { condition: { readStatus: { operator: 'isNot', value: 'IN_PROGRESS' } } }))).toEqual([
          seriesBName,
          'Unknown Series',
        ]);
        expect(bookNames(await searchBooks(filteredCredentials, { condition: { readStatus: { operator: 'is', value: 'IN_PROGRESS' } } }))).toEqual(
          [],
        );
        expect(bookNames(await searchBooks(flat, { condition: { readStatus: { operator: 'is', value: 'READ' } } }))).toEqual(['Alpha Two', 'Manual']);
        expect(seriesNames(await searchSeries(flat, { condition: { readStatus: { operator: 'is', value: 'READ' } } }))).toEqual(['Manual']);
      } finally {
        expect((await komgaSend('DELETE', `/komga/api/v1/books/${alphaOne.bookId}/read-progress`, grouped)).statusCode).toBe(204);
        const unmarked = await ctx.app.inject({
          method: 'PATCH',
          url: `/api/v1/books/${alphaTwo.bookId}/status`,
          headers: authHeader(owner.accessToken),
          payload: { status: 'unread' },
        });
        expect(unmarked.statusCode).toBe(200);
      }
      expect(bookNames(await searchBooks(grouped, { condition: { readStatus: { operator: 'is', value: 'IN_PROGRESS' } } }))).toEqual([]);
    });

    it('keeps member conditions inside the library of each series row', async () => {
      const seriesIds = (page: KomgaPageBody<SeriesBody>) => page.content.map((series) => series.id);
      const comicA = `${comicLibrary.libraryId}-s${seriesAId}`;
      const hiddenA = `${hiddenLibrary.libraryId}-s${seriesAId}`;

      const everything = await searchSeries(superuserCredentials, {});
      expect(seriesIds(everything)).toEqual(expect.arrayContaining([comicA, hiddenA]));
      expect(seriesIds(await searchSeries(superuserCredentials, { condition: { tag: { operator: 'is', value: hiddenTag } } }))).toEqual([hiddenA]);
      expect(seriesIds(await searchSeries(superuserCredentials, { condition: { tag: { operator: 'is', value: matureTag } } }))).toEqual([comicA]);
      const withoutHidden = seriesIds(await searchSeries(superuserCredentials, { condition: { tag: { operator: 'isNot', value: hiddenTag } } }));
      expect(withoutHidden).toContain(comicA);
      expect(withoutHidden).not.toContain(hiddenA);
      expect(seriesIds(await searchSeries(grouped, { condition: { tag: { operator: 'is', value: hiddenTag } } }))).toEqual([]);
    });

    it('hides filtered books from search results', async () => {
      expect(bookNames(await searchBooks(filteredCredentials, { condition: { tag: { operator: 'is', value: matureTag } } }))).toEqual([]);
      expect(seriesNames(await searchSeries(filteredCredentials, { condition: { tag: { operator: 'is', value: matureTag } } }))).toEqual([]);
      expect(bookNames(await searchBooks(filteredCredentials, {}))).not.toContain('Alpha Two');
      const series = await searchSeries(filteredCredentials, { condition: { seriesId: undefined, title: { operator: 'is', value: seriesAName } } });
      expect(series.content).toEqual([expect.objectContaining({ name: seriesAName, booksCount: 3 })]);
    });

    it('answers 400 for unsupported or malformed conditions', async () => {
      const seriesBodies: Array<[Record<string, unknown>, RegExp]> = [
        [{ condition: { poster: { operator: 'is', value: {} } } }, /Unknown search condition: poster/],
        [{ condition: { tag: { operator: 'contains', value: 'x' } } }, /condition\.tag/],
        [{ condition: { allOf: 'x' } }, /expected an array/],
        [{ condition: { tag: { operator: 'is', value: 'a' }, genre: { operator: 'is', value: 'b' } } }, /exactly one condition/],
        [{ condition: { readStatus: { operator: 'is', value: 'SKIMMED' } } }, /readStatus/],
        [{ fullTextSearch: ['x'] }, /fullTextSearch/],
      ];
      for (const [body, message] of seriesBodies) {
        const response = await komgaSend('POST', '/komga/api/v1/series/list', grouped, body);
        expect(response.statusCode).toBe(400);
        expect(String(response.json().message)).toMatch(message);
      }
      for (const leaf of ['numberSort', 'poster', 'readListId']) {
        const response = await komgaSend('POST', '/komga/api/v1/books/list', grouped, { condition: { [leaf]: { operator: 'is', value: '1' } } });
        expect(response.statusCode).toBe(400);
        expect(String(response.json().message)).toBe(`Unsupported search condition: ${leaf}`);
      }
      expect((await komgaSend('POST', '/komga/api/v1/books/list?size=0', grouped, {})).statusCode).toBe(400);
      expect((await komgaSend('POST', '/komga/api/v1/series/list', { username: grouped.username, password: 'nope' }, {})).statusCode).toBe(401);
    });

    it('walks to the next and previous book within the series a book belongs to', async () => {
      const next = await komgaGet(`/komga/api/v1/books/${alphaOne.bookId}/next`, grouped);
      expect(next.statusCode).toBe(200);
      expect(next.json()).toMatchObject({ id: String(alphaTwo.bookId), seriesId: seriesAKey(), metadata: { number: '2' } });

      const previous = await komgaGet(`/komga/api/v1/books/${alphaTwo.bookId}/previous`, grouped);
      expect(previous.json()).toMatchObject({ id: String(alphaOne.bookId), seriesId: seriesAKey() });

      const crossoverInA = await komgaGet(`/komga/api/v1/books/${alphaTwo.bookId}/next`, grouped);
      expect(crossoverInA.json()).toMatchObject({ id: String(crossover.bookId), seriesId: seriesAKey(), metadata: { number: '3', numberSort: 3 } });
      const loose = await komgaGet(`/komga/api/v1/books/${crossover.bookId}/next`, grouped);
      expect(loose.statusCode).toBe(404);

      expect((await komgaGet(`/komga/api/v1/books/${alphaLoose.bookId}/next`, grouped)).statusCode).toBe(404);
      expect((await komgaGet(`/komga/api/v1/books/${alphaOne.bookId}/previous`, grouped)).statusCode).toBe(404);
      expect((await komgaGet(`/komga/api/v1/books/${crossover.bookId}/previous`, grouped)).statusCode).toBe(404);
      expect((await komgaGet(`/komga/api/v1/books/${standalone.bookId}/next`, grouped)).statusCode).toBe(404);
      expect((await komgaGet(`/komga/api/v1/books/${standalone.bookId}/next`, flat)).statusCode).toBe(404);
      expect((await komgaGet(`/komga/api/v1/books/${hiddenComic.bookId}/next`, grouped)).statusCode).toBe(404);
      expect((await komgaGet(`/komga/api/v1/books/${alphaTwo.bookId}/next`, filteredCredentials)).statusCode).toBe(404);
      expect((await komgaGet('/komga/api/v1/books/abc/next', grouped)).statusCode).toBe(400);

      const skipsHidden = await komgaGet(`/komga/api/v1/books/${alphaOne.bookId}/next`, filteredCredentials);
      expect(skipsHidden.statusCode).toBe(200);
      expect(skipsHidden.json()).toMatchObject({ id: String(crossover.bookId), seriesId: seriesAKey() });
    });
  });

  async function komgaGet(url: string, credentials?: Credentials) {
    return ctx.app.inject({
      method: 'GET',
      url,
      headers: credentials ? { authorization: basicAuth(credentials.username, credentials.password) } : {},
    });
  }

  async function komgaSend(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, credentials: Credentials, payload?: Record<string, unknown>) {
    return ctx.app.inject({
      method,
      url,
      headers: { authorization: basicAuth(credentials.username, credentials.password) },
      ...(payload === undefined ? {} : { payload }),
    });
  }

  async function setKomgaApiEnabled(enabled: boolean): Promise<void> {
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/app-settings/komga_api_enabled',
      headers: authHeader(ctx.adminToken),
      payload: { value: String(enabled) },
    });
    expect(response.statusCode).toBe(200);
  }

  async function credentialsFor(userId: number, options: { groupUnknownSeries?: boolean; includeNonComicBooks?: boolean }): Promise<Credentials> {
    const { row, password } = await createKomgaUserCredential(ctx, { userId, ...options });
    return { username: row.username, password };
  }

  async function seedTitle(bookId: number, title: string, description?: string): Promise<void> {
    const values = { bookId, title, ...(description ? { description } : {}) };
    await ctx.db.insert(schema.bookMetadata).values(values).onConflictDoUpdate({ target: schema.bookMetadata.bookId, set: values });
  }

  async function seedPublishedDate(bookId: number, publishedDate: string): Promise<void> {
    await ctx.db.update(schema.bookMetadata).set({ publishedDate }).where(eq(schema.bookMetadata.bookId, bookId));
  }

  async function seedSeries(name: string): Promise<number> {
    const normalizedName = normalizeMetadataTextKey(name);
    if (!normalizedName) throw new Error(`Series normalization failed for ${name}`);
    const [series] = await ctx.db
      .insert(schema.bookSeries)
      .values({ name, normalizedName })
      .onConflictDoUpdate({ target: schema.bookSeries.normalizedName, set: { name } })
      .returning({ id: schema.bookSeries.id });
    return series.id;
  }

  async function seedMembership(bookId: number, seriesId: number, seriesIndex: string | null, displayOrder: number): Promise<void> {
    await ctx.db.insert(schema.bookSeriesMemberships).values({ bookId, seriesId, seriesIndex, displayOrder });
  }

  async function seedTag(bookId: number, name: string): Promise<number> {
    const [tag] = await ctx.db.insert(schema.tags).values({ name }).returning({ id: schema.tags.id });
    await ctx.db.insert(schema.bookTags).values({ bookId, tagId: tag.id });
    return tag.id;
  }

  async function seedAuthor(bookId: number, name: string): Promise<void> {
    const [author] = await ctx.db.insert(schema.authors).values({ name, sortName: name }).returning({ id: schema.authors.id });
    await ctx.db.insert(schema.bookAuthors).values({ bookId, authorId: author.id, displayOrder: 0 });
    await ctx.db.update(schema.books).set({ primaryAuthorSortName: name }).where(eq(schema.books.id, bookId));
  }
});
