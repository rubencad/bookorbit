import { ForbiddenException } from '@nestjs/common';

import type { AppSettingsService } from '../../app-settings/app-settings.service';
import { KomgaEnabledGuard } from '../komga-enabled.guard';

function makeGuard(enabled: boolean) {
  const appSettingsService = { isKomgaApiEnabled: vi.fn().mockResolvedValue(enabled) } as unknown as AppSettingsService;
  return new KomgaEnabledGuard(appSettingsService);
}

describe('KomgaEnabledGuard', () => {
  it('passes when the Komga API is enabled', async () => {
    await expect(makeGuard(true).canActivate()).resolves.toBe(true);
  });

  it('answers 403 when the Komga API is disabled', async () => {
    await expect(makeGuard(false).canActivate()).rejects.toThrow(new ForbiddenException('Komga API is disabled'));
  });
});
