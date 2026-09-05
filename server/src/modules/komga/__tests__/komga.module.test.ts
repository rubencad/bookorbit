import 'reflect-metadata';

import { MODULE_METADATA } from '@nestjs/common/constants';

import { CommonModule } from '../../../common/common.module';
import { AppSettingsModule } from '../../app-settings/app-settings.module';
import { UserModule } from '../../user/user.module';
import { KomgaAuthGuard } from '../komga-auth.guard';
import { KomgaEnabledGuard } from '../komga-enabled.guard';
import { KomgaFallbackController } from '../komga-fallback.controller';
import { KomgaUserController } from '../komga-user.controller';
import { KomgaUserRepository } from '../komga-user.repository';
import { KomgaUserService } from '../komga-user.service';
import { KomgaModule } from '../komga.module';

describe('KomgaModule', () => {
  it('registers the module wiring', () => {
    expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, KomgaModule)).toEqual([AppSettingsModule, UserModule, CommonModule]);
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, KomgaModule)).toEqual([KomgaUserController, KomgaFallbackController]);
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, KomgaModule)).toEqual([
      KomgaUserRepository,
      KomgaUserService,
      KomgaAuthGuard,
      KomgaEnabledGuard,
    ]);
  });
});
