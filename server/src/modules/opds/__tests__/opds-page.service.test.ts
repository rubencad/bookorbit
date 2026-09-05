import { NotFoundException } from '@nestjs/common';

import { OpdsPageService } from '../opds-page.service';

const MIXED_FILE = { id: 7, absolutePath: '/books/saga.cbz', format: 'cbz', pageCount: 3, pageMediaType: null, mtime: new Date('2026-01-01') };
const PNG_FILE = { ...MIXED_FILE, id: 8, pageMediaType: 'image/png' };

function makeService(pages: { mimeType: string }[] = [{ mimeType: 'image/png' }, { mimeType: 'image/jpeg' }, { mimeType: 'image/webp' }]) {
  const opdsBookService = { getComicFile: vi.fn().mockResolvedValue(MIXED_FILE) };
  const comicPageService = {
    getManifest: vi.fn().mockResolvedValue({
      format: 'cbz',
      pageMediaType: null,
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

      await expect(service.resolveComicFile(42, 7)).resolves.toEqual(MIXED_FILE);
      expect(opdsBookService.getComicFile).toHaveBeenCalledWith(42, 7);
    });

    it('answers 404 when the book has no matching comic file', async () => {
      const { service, opdsBookService } = makeService();
      opdsBookService.getComicFile.mockResolvedValue(null);

      await expect(service.resolveComicFile(42)).rejects.toThrow(new NotFoundException('Comic file not found'));
    });
  });

  describe('streamPage', () => {
    it('serves every page of a mixed archive as the advertised JPEG type', async () => {
      const { service, comicPageService } = makeService();

      await service.streamPage(MIXED_FILE, 0);
      await service.streamPage(MIXED_FILE, 1, 800);
      await service.streamPage(MIXED_FILE, 2);

      expect(comicPageService.streamPage.mock.calls).toEqual([
        [MIXED_FILE, 0, { maxWidth: undefined, convert: 'jpeg' }],
        [MIXED_FILE, 1, { maxWidth: 800, convert: undefined }],
        [MIXED_FILE, 2, { maxWidth: undefined, convert: 'jpeg' }],
      ]);
    });

    it('passes the pages of an all-PNG archive through and converts a page that no longer matches', async () => {
      const { service, comicPageService } = makeService([{ mimeType: 'image/png' }, { mimeType: 'image/jpeg' }]);

      await service.streamPage(PNG_FILE, 0, 1200);
      await service.streamPage(PNG_FILE, 1);

      expect(comicPageService.streamPage.mock.calls.map((call) => call[2])).toEqual([
        { maxWidth: 1200, convert: undefined },
        { maxWidth: undefined, convert: 'png' },
      ]);
    });

    it('answers 404 for pages outside the archive without opening a page', async () => {
      const { service, comicPageService } = makeService();

      await expect(service.streamPage(MIXED_FILE, 3)).rejects.toThrow(new NotFoundException('Page 3 out of range'));
      await expect(service.streamPage(MIXED_FILE, -1)).rejects.toThrow(new NotFoundException('Page -1 out of range'));
      expect(comicPageService.streamPage).not.toHaveBeenCalled();
    });

    it('returns the stream and mime type the page service produced', async () => {
      const { service } = makeService();

      await expect(service.streamPage(MIXED_FILE, 1)).resolves.toEqual({ stream: { kind: 'stream' }, mimeType: 'image/jpeg' });
    });
  });
});
