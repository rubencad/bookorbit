import { BadRequestException } from '@nestjs/common';

import type { RequestUser } from '../../../common/types/request-user';
import type { KomgaRequestAccount } from '../komga-auth.guard';
import { KomgaReadProgressController } from '../komga-read-progress.controller';

const USER = { id: 1 } as RequestUser;
const ACCOUNT = { id: 3 } as KomgaRequestAccount;

function createController() {
  const service = {
    updateBook: vi.fn().mockResolvedValue(undefined),
    clearBook: vi.fn().mockResolvedValue(undefined),
    markSeriesRead: vi.fn().mockResolvedValue(undefined),
    clearSeries: vi.fn().mockResolvedValue(undefined),
    tachiyomiProgressV1: vi.fn().mockResolvedValue({ lastReadContinuousIndex: 2 }),
    tachiyomiProgressV2: vi.fn().mockResolvedValue({ lastReadContinuousNumberSort: 2 }),
    markReadUpToIndex: vi.fn().mockResolvedValue(undefined),
    markReadUpToNumberSort: vi.fn().mockResolvedValue(undefined),
  };
  return { controller: new KomgaReadProgressController(service as never), service };
}

describe('KomgaReadProgressController', () => {
  it('parses the book id and the Komga read progress body, ignoring unknown fields', async () => {
    const { controller, service } = createController();
    await controller.updateBook(USER, ACCOUNT, '42', { page: 3, completed: false, deviceId: 'phone' });

    expect(service.updateBook).toHaveBeenCalledWith(USER, ACCOUNT, 42, { page: 3, completed: false });
  });

  it('rejects malformed ids and bodies before touching the service', async () => {
    const { controller, service } = createController();
    await expect(controller.updateBook(USER, ACCOUNT, 'abc', { page: 1 })).rejects.toThrow(BadRequestException);
    await expect(controller.updateBook(USER, ACCOUNT, '42', { page: 'three' })).rejects.toThrow(BadRequestException);
    await expect(controller.updateBook(USER, ACCOUNT, '42', 'not json')).rejects.toThrow(BadRequestException);
    await expect(controller.updateTachiyomiV2(USER, ACCOUNT, '2-s9', {})).rejects.toThrow(BadRequestException);
    await expect(controller.updateTachiyomiV1(USER, ACCOUNT, '2-s9', { lastBookRead: -1 })).rejects.toThrow(BadRequestException);
    expect(service.updateBook).not.toHaveBeenCalled();
    expect(service.markReadUpToNumberSort).not.toHaveBeenCalled();
    expect(service.markReadUpToIndex).not.toHaveBeenCalled();
  });

  it('routes series and tracker calls with their parsed payloads', async () => {
    const { controller, service } = createController();
    await controller.clearBook(USER, ACCOUNT, '7');
    await controller.markSeriesRead(USER, ACCOUNT, '2-s9');
    await controller.clearSeries(USER, ACCOUNT, '2-u');
    await controller.updateTachiyomiV1(USER, ACCOUNT, '2-s9', { lastBookRead: 4 });
    await controller.updateTachiyomiV2(USER, ACCOUNT, '2-s9', { lastBookNumberSortRead: 4.5 });

    expect(service.clearBook).toHaveBeenCalledWith(USER, ACCOUNT, 7);
    expect(service.markSeriesRead).toHaveBeenCalledWith(USER, ACCOUNT, '2-s9');
    expect(service.clearSeries).toHaveBeenCalledWith(USER, ACCOUNT, '2-u');
    expect(service.markReadUpToIndex).toHaveBeenCalledWith(USER, ACCOUNT, '2-s9', 4);
    expect(service.markReadUpToNumberSort).toHaveBeenCalledWith(USER, ACCOUNT, '2-s9', 4.5);
    await expect(controller.tachiyomiV1(USER, ACCOUNT, '2-s9')).resolves.toEqual({ lastReadContinuousIndex: 2 });
    await expect(controller.tachiyomiV2(USER, ACCOUNT, '2-s9')).resolves.toEqual({ lastReadContinuousNumberSort: 2 });
  });
});
