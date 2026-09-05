import { Module } from '@nestjs/common';

import { CommonModule } from '../../common/common.module';
import { AppSettingsModule } from '../app-settings/app-settings.module';
import { UserModule } from '../user/user.module';
import { KomgaAuthGuard } from './komga-auth.guard';
import { KomgaBookController } from './komga-book.controller';
import { KomgaBookService } from './komga-book.service';
import { KomgaCatalogRepository } from './komga-catalog.repository';
import { KomgaEnabledGuard } from './komga-enabled.guard';
import { KomgaFallbackController } from './komga-fallback.controller';
import { KomgaLibraryController } from './komga-library.controller';
import { KomgaLibraryService } from './komga-library.service';
import { KomgaListController } from './komga-list.controller';
import { KomgaMeController } from './komga-me.controller';
import { KomgaReferentialController } from './komga-referential.controller';
import { KomgaReferentialService } from './komga-referential.service';
import { KomgaSeriesController } from './komga-series.controller';
import { KomgaSeriesService } from './komga-series.service';
import { KomgaUserController } from './komga-user.controller';
import { KomgaUserRepository } from './komga-user.repository';
import { KomgaUserService } from './komga-user.service';

@Module({
  imports: [AppSettingsModule, UserModule, CommonModule],
  controllers: [
    KomgaUserController,
    KomgaMeController,
    KomgaLibraryController,
    KomgaSeriesController,
    KomgaBookController,
    KomgaReferentialController,
    KomgaListController,
    KomgaFallbackController,
  ],
  providers: [
    KomgaUserRepository,
    KomgaUserService,
    KomgaAuthGuard,
    KomgaEnabledGuard,
    KomgaCatalogRepository,
    KomgaLibraryService,
    KomgaBookService,
    KomgaSeriesService,
    KomgaReferentialService,
  ],
})
export class KomgaModule {}
