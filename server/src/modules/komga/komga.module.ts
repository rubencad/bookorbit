import { Module } from '@nestjs/common';

import { CommonModule } from '../../common/common.module';
import { AppSettingsModule } from '../app-settings/app-settings.module';
import { UserModule } from '../user/user.module';
import { KomgaAuthGuard } from './komga-auth.guard';
import { KomgaEnabledGuard } from './komga-enabled.guard';
import { KomgaFallbackController } from './komga-fallback.controller';
import { KomgaUserController } from './komga-user.controller';
import { KomgaUserRepository } from './komga-user.repository';
import { KomgaUserService } from './komga-user.service';

@Module({
  imports: [AppSettingsModule, UserModule, CommonModule],
  controllers: [KomgaUserController, KomgaFallbackController],
  providers: [KomgaUserRepository, KomgaUserService, KomgaAuthGuard, KomgaEnabledGuard],
})
export class KomgaModule {}
