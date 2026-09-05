import { ForbiddenException } from '@nestjs/common';
import { PassThrough } from 'stream';

import { CbzService } from './cbz.service';

describe('CbzService', () => {
  const user = { id: 9, isSuperuser: false, permissions: [] } as any;
  const file = { id: 4, absolutePath: '/books/issue.cbz', format: 'cbz', pageCount: null };
  const bookService = { verifyFileAccess: vi.fn() };
  const comicPageService = { getPageCount: vi.fn(), streamPage: vi.fn() };

  let service: CbzService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new CbzService(bookService as any, comicPageService as any);
  });

  it('counts pages of the file the access check resolved', async () => {
    bookService.verifyFileAccess.mockResolvedValue(file);
    comicPageService.getPageCount.mockResolvedValue(12);

    await expect(service.getPageCount(4, user)).resolves.toBe(12);

    expect(bookService.verifyFileAccess).toHaveBeenCalledWith(4, user);
    expect(comicPageService.getPageCount).toHaveBeenCalledWith(file);
  });

  it('streams the requested page of the file the access check resolved', async () => {
    const stream = new PassThrough();
    bookService.verifyFileAccess.mockResolvedValue(file);
    comicPageService.streamPage.mockResolvedValue({ stream, mimeType: 'image/png' });

    await expect(service.streamPage(4, 3, user)).resolves.toEqual({ stream, mimeType: 'image/png' });

    expect(comicPageService.streamPage).toHaveBeenCalledWith(file, 3);
  });

  it('never touches the archive when access is denied', async () => {
    bookService.verifyFileAccess.mockRejectedValue(new ForbiddenException('No access to this library'));

    await expect(service.getPageCount(4, user)).rejects.toThrow(ForbiddenException);
    await expect(service.streamPage(4, 0, user)).rejects.toThrow(ForbiddenException);

    expect(comicPageService.getPageCount).not.toHaveBeenCalled();
    expect(comicPageService.streamPage).not.toHaveBeenCalled();
  });
});
