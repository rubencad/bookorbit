import { NotFoundException } from '@nestjs/common';

import { OpdsPageService } from '../opds-page.service';

const FILE = { id: 7, absolutePath: '/books/saga.cbz', format: 'cbz', pageCount: 3, pageMediaType: 'image/png', mtime: new Date('2026-01-01') };

function makeService(pages: { mimeType: string }[] = [{ mimeType: 'image/png' }, { mimeType: 'image/jpeg' }, { mimeType: 'image/webp' }]) {
  const opdsBookService = { getComicFile: vi.fn().mockResolvedValue(FILE) };
  const comicPageService = {
    getManifest: vi.fn().mockResolvedValue({
      format: 'cbz',
      pageMediaType: 'image/*',
      pages: pages.map((page, index) => ({ index, entryName: `${index}.img`, sizeBytes: 1, ...page })),
    }),
    streamPage: vi.fn().mockResolvedValue({ stream: { kind: 'stream' }, mimeType: 'image/jpeg' }),
  };
  return { service: new OpdsPageService(opdsBookService as never, comicPageService as never), opdsBookService, comicPageService };
}

describe('OpdsPageService', () => {
  describe('resolveComicFile', () => {
    it('returns the comic file of the book', async () => {
      const { service, opdsBookService } = makeService();

      await expect(service.resolveComicFile(42, 7)).resolves.toEqual(FILE);
      expect(opdsBookService.getComicFile).toHaveBeenCalledWith(42, 7);
    });

    it('returns 404 when the book has no matching comic file', async () => {
      const { service, opdsBookService } = makeService();
      opdsBookService.getComicFile.mockResolvedValue(null);

      await expect(service.resolveComicFile(42)).rejects.toThrow(new NotFoundException('Comic file not found'));
    });
  });

  describe('streamPage', () => {
    it('serves every page as the format the link pinned, converting pages that differ', async () => {
      const { service, comicPageService } = makeService();

      await service.streamPage(FILE, 0, 'jpeg');
      await service.streamPage(FILE, 1, 'jpeg', 800);
      await service.streamPage(FILE, 2, 'jpeg');

      expect(comicPageService.streamPage.mock.calls).toEqual([
        [FILE, 0, { maxWidth: undefined, convert: 'jpeg' }],
        [FILE, 1, { maxWidth: 800, convert: undefined }],
        [FILE, 2, { maxWidth: undefined, convert: 'jpeg' }],
      ]);
    });

    it('serves every page as PNG when the archive is advertised as PNG', async () => {
      const { service, comicPageService } = makeService([{ mimeType: 'image/png' }, { mimeType: 'image/jpeg' }]);

      await service.streamPage(FILE, 0, 'png', 1200);
      await service.streamPage(FILE, 1, 'png');

      expect(comicPageService.streamPage.mock.calls.map((call) => call[2])).toEqual([
        { maxWidth: 1200, convert: undefined },
        { maxWidth: undefined, convert: 'png' },
      ]);
    });

    it('ignores the stored page media type in favour of the format the link pinned', async () => {
      const { service, comicPageService } = makeService([{ mimeType: 'image/png' }]);

      await service.streamPage({ ...FILE, pageMediaType: 'image/png' }, 0, 'jpeg');
      await service.streamPage({ ...FILE, pageMediaType: null }, 0, 'png');

      expect(comicPageService.streamPage.mock.calls.map((call) => call[2])).toEqual([
        { maxWidth: undefined, convert: 'jpeg' },
        { maxWidth: undefined, convert: undefined },
      ]);
    });

    it('returns 404 for pages outside the archive without opening a page', async () => {
      const { service, comicPageService } = makeService();

      await expect(service.streamPage(FILE, 3, 'jpeg')).rejects.toThrow(new NotFoundException('Page 3 out of range'));
      await expect(service.streamPage(FILE, -1, 'jpeg')).rejects.toThrow(new NotFoundException('Page -1 out of range'));
      expect(comicPageService.streamPage).not.toHaveBeenCalled();
    });

    it('returns the stream and mime type the page service produced', async () => {
      const { service } = makeService();

      await expect(service.streamPage(FILE, 1, 'jpeg')).resolves.toEqual({ stream: { kind: 'stream' }, mimeType: 'image/jpeg' });
    });
  });
});
