import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { mkdtemp, rm, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import sharp from 'sharp';

import { getSevenZip, runSevenZip } from '../../common/sevenzip';
import {
  COMIC_PAGE_JPEG,
  COMIC_PAGE_PNG,
  createCb7ComicFixture,
  createCbrComicFixture,
  createCbzComicFixture,
  type ComicFixtureEntry,
} from '../../../test/e2e/comics/comic-fixture-builder';
import { buildStoredRarArchive } from '../../../test/e2e/comics/rar-stored-archive';
import { ComicPageService, MAX_EXTRACTED_PAGE_BYTES } from './comic-page.service';

const TWO_PAGE_ENTRIES: ComicFixtureEntry[] = [
  { path: 'pages/010-spread.jpg', content: COMIC_PAGE_JPEG },
  { path: 'pages/002-cover.png', content: COMIC_PAGE_PNG },
  { path: '.hidden/003-secret.png', content: COMIC_PAGE_PNG },
  { path: '__MACOSX/pages/._010-spread.jpg', content: Buffer.from('resource fork') },
  { path: 'ComicInfo.xml', content: '<ComicInfo/>' },
  { path: 'notes/readme.txt', content: 'not a page' },
];

async function readStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe('ComicPageService', () => {
  let root: string;
  let repository: { updatePageCount: ReturnType<typeof vi.fn> };
  let service: ComicPageService;
  let nextFileId = 1;

  const fileRef = (absolutePath: string, format: string | null, pageCount: number | null = null) => ({
    id: nextFileId++,
    absolutePath,
    format,
    pageCount,
  });

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'comic-page-service-'));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  beforeEach(() => {
    repository = { updatePageCount: vi.fn().mockResolvedValue(undefined) };
    service = new ComicPageService(repository as any);
  });

  describe.each([
    ['cbz', createCbzComicFixture],
    ['cbr', createCbrComicFixture],
    ['cb7', createCb7ComicFixture],
  ] as const)('%s archives', (format, createFixture) => {
    it('lists visible pages in natural order with sizes and mime types', async () => {
      const path = await createFixture(root, `${format}/manifest.${format}`, TWO_PAGE_ENTRIES);

      const manifest = await service.getManifest(fileRef(path, format));

      expect(manifest.format).toBe(format);
      expect(manifest.pages.map((page) => [page.index, page.entryName, page.mimeType, page.sizeBytes])).toEqual([
        [0, 'pages/002-cover.png', 'image/png', COMIC_PAGE_PNG.length],
        [1, 'pages/010-spread.jpg', 'image/jpeg', COMIC_PAGE_JPEG.length],
      ]);
    });

    it('streams the exact page bytes', async () => {
      const path = await createFixture(root, `${format}/stream.${format}`, TWO_PAGE_ENTRIES);
      const file = fileRef(path, format);

      const first = await service.streamPage(file, 0);
      const second = await service.streamPage(file, 1);

      expect(first.mimeType).toBe('image/png');
      await expect(readStream(first.stream)).resolves.toEqual(COMIC_PAGE_PNG);
      expect(second.mimeType).toBe('image/jpeg');
      await expect(readStream(second.stream)).resolves.toEqual(COMIC_PAGE_JPEG);
    });

    it('rejects page indexes outside the archive', async () => {
      const path = await createFixture(root, `${format}/bounds.${format}`, TWO_PAGE_ENTRIES);
      const file = fileRef(path, format);

      await expect(service.streamPage(file, -1)).rejects.toThrow(new NotFoundException('Page -1 out of range'));
      await expect(service.streamPage(file, 2)).rejects.toThrow(new NotFoundException('Page 2 out of range'));
    });

    it('returns 422 for an invalid archive', async () => {
      const path = join(root, `${format}/garbage.${format}`);
      await writeFile(path, Buffer.from('definitely not an archive'));

      await expect(service.getPageCount(fileRef(path, format))).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  it('persists the page count once per manifest build and serves repeats from the cache', async () => {
    const path = await createCbzComicFixture(root, 'cache/persist.cbz', TWO_PAGE_ENTRIES);
    const file = fileRef(path, 'cbz');

    await expect(service.getPageCount(file)).resolves.toBe(2);
    await expect(service.getPageCount(file)).resolves.toBe(2);
    await expect(service.streamPage(file, 0)).resolves.toBeDefined();

    expect(repository.updatePageCount).toHaveBeenCalledTimes(1);
    expect(repository.updatePageCount).toHaveBeenCalledWith(file.id, 2);
  });

  it('shares one manifest build between concurrent requests', async () => {
    const path = await createCbzComicFixture(root, 'cache/concurrent.cbz', TWO_PAGE_ENTRIES);
    const file = fileRef(path, 'cbz');

    await expect(Promise.all([service.getPageCount(file), service.getPageCount(file), service.getPageCount(file)])).resolves.toEqual([2, 2, 2]);

    expect(repository.updatePageCount).toHaveBeenCalledTimes(1);
  });

  it('skips the write when the row already carries the count', async () => {
    const path = await createCbzComicFixture(root, 'cache/known.cbz', TWO_PAGE_ENTRIES);

    await expect(service.getPageCount(fileRef(path, 'cbz', 2))).resolves.toBe(2);

    expect(repository.updatePageCount).not.toHaveBeenCalled();
  });

  it('rebuilds the manifest when the file changes on disk', async () => {
    const relativePath = 'cache/rewritten.cbz';
    const path = await createCbzComicFixture(root, relativePath, TWO_PAGE_ENTRIES);
    const file = fileRef(path, 'cbz');
    await expect(service.getPageCount(file)).resolves.toBe(2);

    await createCbzComicFixture(root, relativePath, [...TWO_PAGE_ENTRIES, { path: 'pages/011-back.jpg', content: COMIC_PAGE_JPEG }]);
    const later = new Date(Date.now() + 10_000);
    await utimes(path, later, later);

    await expect(service.getPageCount(file)).resolves.toBe(3);
    expect(repository.updatePageCount).toHaveBeenLastCalledWith(file.id, 3);
  });

  it('still serves pages when the count cannot be persisted', async () => {
    const path = await createCbzComicFixture(root, 'cache/db-down.cbz', TWO_PAGE_ENTRIES);
    repository.updatePageCount.mockRejectedValue(new Error('connection lost'));

    await expect(service.getPageCount(fileRef(path, 'cbz'))).resolves.toBe(2);
  });

  it('recounts the archive and stores the result', async () => {
    const path = await createCbrComicFixture(root, 'refresh/issue.cbr', TWO_PAGE_ENTRIES);
    const file = fileRef(path, 'cbr');

    await expect(service.refreshPageCount(file)).resolves.toBe(2);

    expect(repository.updatePageCount).toHaveBeenCalledWith(file.id, 2);
  });

  it('clears the stored count when a refresh finds the archive unreadable', async () => {
    const path = join(root, 'refresh/replaced.cbz');
    await writeFile(path, Buffer.from('this used to be a comic'));
    const file = fileRef(path, 'cbz', 12);

    await expect(service.refreshPageCount(file)).rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(repository.updatePageCount).toHaveBeenCalledTimes(1);
    expect(repository.updatePageCount).toHaveBeenCalledWith(file.id, null);
  });

  it('clears the stored count when a refresh finds the file gone', async () => {
    const file = fileRef(join(root, 'refresh/vanished.cbr'), 'cbr', 12);

    await expect(service.refreshPageCount(file)).rejects.toBeInstanceOf(NotFoundException);

    expect(repository.updatePageCount).toHaveBeenCalledWith(file.id, null);
  });

  it('rejects password-protected CBR archives', async () => {
    const path = join(root, 'locked.cbr');
    await writeFile(path, buildStoredRarArchive([{ name: '001.jpg', data: COMIC_PAGE_JPEG, encrypted: true }]));

    await expect(service.getPageCount(fileRef(path, 'cbr'))).rejects.toThrow(new UnprocessableEntityException('CBR archive is password protected'));
  });

  it('propagates a persistence failure from an explicit refresh', async () => {
    const path = await createCbzComicFixture(root, 'refresh/failing.cbz', TWO_PAGE_ENTRIES);
    repository.updatePageCount.mockRejectedValue(new Error('connection lost'));

    await expect(service.refreshPageCount(fileRef(path, 'cbz'))).rejects.toThrow('connection lost');
  });

  it('rejects formats that are not comic containers without touching the disk', async () => {
    await expect(service.getPageCount(fileRef(join(root, 'missing.epub'), 'epub'))).rejects.toThrow(
      new NotFoundException('Unsupported comic format: epub'),
    );
    await expect(service.getPageCount(fileRef(join(root, 'missing'), null))).rejects.toThrow(new NotFoundException('Unsupported comic format: '));
  });

  it('returns 404 when the file is missing', async () => {
    const file = fileRef(join(root, 'gone/issue.cbz'), 'cbz');

    await expect(service.getPageCount(file)).rejects.toThrow(new NotFoundException(`File ${file.id} not found on disk`));
  });

  it('reads a RAR saved with a .cbz extension through the RAR path', async () => {
    const path = await createCbrComicFixture(root, 'mislabelled/rar-inside.cbz', TWO_PAGE_ENTRIES);
    const file = fileRef(path, 'cbz');

    const manifest = await service.getManifest(file);
    expect(manifest.format).toBe('cbr');
    await expect(readStream((await service.streamPage(file, 1)).stream)).resolves.toEqual(COMIC_PAGE_JPEG);
  });

  it('refuses to extract a page declared larger than the extraction limit', async () => {
    const path = join(root, 'huge.cbr');
    await writeFile(
      path,
      buildStoredRarArchive([
        { name: '001.jpg', data: COMIC_PAGE_JPEG },
        { name: '002.jpg', data: COMIC_PAGE_JPEG, declaredSize: MAX_EXTRACTED_PAGE_BYTES + 1 },
      ]),
    );
    const file = fileRef(path, 'cbr');

    await expect(readStream((await service.streamPage(file, 0)).stream)).resolves.toEqual(COMIC_PAGE_JPEG);
    await expect(service.streamPage(file, 1)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects password-protected CB7 archives', async () => {
    const sevenZip = await getSevenZip();
    const sourceDirectory = await mkdtemp(join(root, 'enc-src-'));
    await writeFile(join(sourceDirectory, 'page.png'), COMIC_PAGE_PNG);
    sevenZip.FS.mkdir('/enc_src');
    sevenZip.FS.mount(sevenZip.NODEFS, { root: sourceDirectory }, '/enc_src');
    try {
      runSevenZip(sevenZip, ['a', '/enc.cb7', '/enc_src/page.png', '-psecret', '-y', '-bsp0', '-bso0']);
      await writeFile(join(root, 'locked.cb7'), Buffer.from(sevenZip.FS.readFile('/enc.cb7')));
    } finally {
      sevenZip.FS.unlink('/enc.cb7');
      sevenZip.FS.unmount('/enc_src');
      sevenZip.FS.rmdir('/enc_src');
    }

    await expect(service.getPageCount(fileRef(join(root, 'locked.cb7'), 'cb7'))).rejects.toThrow(
      new UnprocessableEntityException('CB7 archive is password protected'),
    );
  });

  describe('transforms', () => {
    let path: string;

    beforeAll(async () => {
      const wide = await sharp({ create: { width: 4, height: 2, channels: 3, background: '#ffffff' } })
        .png()
        .toBuffer();
      path = await createCbzComicFixture(root, 'transform/wide.cbz', [{ path: 'wide.png', content: wide }]);
    });

    it('passes bytes through untouched without a transform', async () => {
      const page = await service.streamPage(fileRef(path, 'cbz'), 0);
      const metadata = await sharp(await readStream(page.stream)).metadata();

      expect(page.mimeType).toBe('image/png');
      expect([metadata.width, metadata.height, metadata.format]).toEqual([4, 2, 'png']);
    });

    it('shrinks to maxWidth without enlarging', async () => {
      const shrunk = await service.streamPage(fileRef(path, 'cbz'), 0, { maxWidth: 2 });
      const untouched = await service.streamPage(fileRef(path, 'cbz'), 0, { maxWidth: 40 });

      expect((await sharp(await readStream(shrunk.stream)).metadata()).width).toBe(2);
      expect((await sharp(await readStream(untouched.stream)).metadata()).width).toBe(4);
    });

    it('converts to jpeg and png and reports the new mime type', async () => {
      const jpeg = await service.streamPage(fileRef(path, 'cbz'), 0, { convert: 'jpeg' });
      const bytes = await readStream(jpeg.stream);

      expect(jpeg.mimeType).toBe('image/jpeg');
      expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
      expect((await sharp(bytes).metadata()).format).toBe('jpeg');

      const png = await service.streamPage(fileRef(path, 'cbz'), 0, { convert: 'png', maxWidth: 1 });
      expect(png.mimeType).toBe('image/png');
      expect((await sharp(await readStream(png.stream)).metadata()).width).toBe(1);
    });
  });
});
