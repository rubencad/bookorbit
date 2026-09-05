import type { AppSettingsService } from '../../app-settings/app-settings.service';
import { KomgaStatusController } from '../komga-status.controller';

describe('KomgaStatusController', () => {
  it('returns the current Komga enabled state', async () => {
    const enabled = { isKomgaApiEnabled: vi.fn().mockResolvedValue(true) } as unknown as AppSettingsService;
    await expect(new KomgaStatusController(enabled).status()).resolves.toEqual({ enabled: true });

    const disabled = { isKomgaApiEnabled: vi.fn().mockResolvedValue(false) } as unknown as AppSettingsService;
    await expect(new KomgaStatusController(disabled).status()).resolves.toEqual({ enabled: false });
  });
});
