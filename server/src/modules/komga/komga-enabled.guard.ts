import { CanActivate, ForbiddenException, Injectable } from '@nestjs/common';

import { AppSettingsService } from '../app-settings/app-settings.service';

@Injectable()
export class KomgaEnabledGuard implements CanActivate {
  constructor(private readonly appSettingsService: AppSettingsService) {}

  async canActivate(): Promise<boolean> {
    if (!(await this.appSettingsService.isKomgaApiEnabled())) {
      throw new ForbiddenException('Komga API is disabled');
    }
    return true;
  }
}
