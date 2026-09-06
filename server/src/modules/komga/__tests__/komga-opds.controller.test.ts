import { BadRequestException } from '@nestjs/common';

import type { RequestUser } from '../../../common/types/request-user';
import type { KomgaRequestAccount } from '../komga-auth.guard';
import { KomgaOpdsController } from '../komga-opds.controller';

const USER = { id: 1 } as RequestUser;
const ACCOUNT = { id: 3 } as KomgaRequestAccount;

function createController() {
  const opdsService = { catalog: vi.fn().mockReturnValue('<feed/>') };
  const bookService = {
    streamPage: vi.fn().mockResolvedValue({ stream: { stream: 'body', mimeType: 'image/jpeg' }, etag: '"e"' }),
    requireVisibleBookId: vi.fn().mockResolvedValue(42),
    resolveDownload: vi.fn(),
  };
  const thumbnailService = { send: vi.fn() };
  const reply = { type: vi.fn(), send: vi.fn(), header: vi.fn(), status: vi.fn() };
  reply.type.mockReturnValue(reply);
  reply.status.mockReturnValue(reply);

  const controller = new KomgaOpdsController(opdsService as never, bookService as never, thumbnailService as never);
  return { controller, opdsService, bookService, thumbnailService, reply };
}

describe('KomgaOpdsController', () => {
  it('serves the catalog from the bare /opds address clients are given', () => {
    const { controller, opdsService, reply } = createController();
    controller.root(reply as never);

    expect(opdsService.catalog).toHaveBeenCalled();
    expect(reply.type).toHaveBeenCalledWith('application/atom+xml;profile=opds-catalog;kind=navigation; charset=utf-8');
    expect(reply.send).toHaveBeenCalledWith('<feed/>');
  });

  it('treats OPDS page numbers as zero based', async () => {
    const { controller, bookService, reply } = createController();
    await controller.page(USER, ACCOUNT, '42', '0', {}, reply as never);

    expect(bookService.streamPage).toHaveBeenCalledWith(USER, ACCOUNT, 42, 0, { convert: undefined, zero_based: true });
  });

  it('passes the requested conversion through to the page stream', async () => {
    const { controller, bookService, reply } = createController();
    await controller.page(USER, ACCOUNT, '42', '3', { convert: 'png' }, reply as never);

    expect(bookService.streamPage).toHaveBeenCalledWith(USER, ACCOUNT, 42, 3, { convert: 'png', zero_based: true });
  });

  it('rejects a page number that is not a plain integer', async () => {
    const { controller, reply } = createController();

    await expect(controller.page(USER, ACCOUNT, '42', '-1', {}, reply as never)).rejects.toThrow(BadRequestException);
  });

  it('answers a conditional page request with 304', async () => {
    const { controller, reply } = createController();
    await controller.page(USER, ACCOUNT, '42', '0', {}, reply as never, '"e"');

    expect(reply.status).toHaveBeenCalledWith(304);
  });

  it('serves the same thumbnail for both Komga thumbnail routes', async () => {
    const { controller, thumbnailService, reply } = createController();
    await controller.thumbnailSmall(USER, ACCOUNT, '42', reply as never);
    await controller.thumbnail(USER, ACCOUNT, '42', reply as never);

    expect(thumbnailService.send).toHaveBeenNthCalledWith(1, 42, reply, undefined);
    expect(thumbnailService.send).toHaveBeenNthCalledWith(2, 42, reply, undefined);
  });

  it('rejects a library id that is not a positive integer', async () => {
    const { controller, reply } = createController();

    await expect(controller.library(USER, ACCOUNT, 'abc', {}, reply as never)).rejects.toThrow(BadRequestException);
  });
});
