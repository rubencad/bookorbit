import { Permission, type KomgaApiStatus } from '@bookorbit/types';
import { Controller, Get } from '@nestjs/common';

import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AppSettingsService } from '../app-settings/app-settings.service';

@Controller('komga-api')
@RequirePermission(Permission.KomgaAccess)
export class KomgaStatusController {
  constructor(private readonly appSettingsService: AppSettingsService) {}

  @Get('status')
  async status(): Promise<KomgaApiStatus> {
    return { enabled: await this.appSettingsService.isKomgaApiEnabled() };
  }
}
