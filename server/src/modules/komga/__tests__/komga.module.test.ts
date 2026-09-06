import 'reflect-metadata';

import { MODULE_METADATA } from '@nestjs/common/constants';

import { CommonModule } from '../../../common/common.module';
import { AppSettingsModule } from '../../app-settings/app-settings.module';
import { BookModule } from '../../book/book.module';
import { ComicPagesModule } from '../../comic-pages/comic-pages.module';
import { UserModule } from '../../user/user.module';
import { KomgaAuthGuard } from '../komga-auth.guard';
import { KomgaBookController } from '../komga-book.controller';
import { KomgaBookService } from '../komga-book.service';
import { KomgaCatalogRepository } from '../komga-catalog.repository';
import { KomgaEnabledGuard } from '../komga-enabled.guard';
import { KomgaFallbackController } from '../komga-fallback.controller';
import { KomgaLibraryController } from '../komga-library.controller';
import { KomgaLibraryService } from '../komga-library.service';
import { KomgaListController } from '../komga-list.controller';
import { KomgaMeController } from '../komga-me.controller';
import { KomgaOpdsController } from '../komga-opds.controller';
import { KomgaOpdsService } from '../komga-opds.service';
import { KomgaReadProgressController } from '../komga-read-progress.controller';
import { KomgaReadProgressService } from '../komga-read-progress.service';
import { KomgaReferentialController } from '../komga-referential.controller';
import { KomgaReferentialService } from '../komga-referential.service';
import { KomgaSeriesController } from '../komga-series.controller';
import { KomgaSeriesService } from '../komga-series.service';
import { KomgaStatusController } from '../komga-status.controller';
import { KomgaThumbnailService } from '../komga-thumbnail.service';
import { KomgaUserController } from '../komga-user.controller';
import { KomgaUserRepository } from '../komga-user.repository';
import { KomgaUserService } from '../komga-user.service';
import { KomgaModule } from '../komga.module';

describe('KomgaModule', () => {
  it('registers the module wiring', () => {
    expect(Reflect.getMetadata(MODULE_METADATA.IMPORTS, KomgaModule)).toEqual([
      AppSettingsModule,
      BookModule,
      UserModule,
      CommonModule,
      ComicPagesModule,
    ]);
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, KomgaModule)).toEqual([
      KomgaUserController,
      KomgaStatusController,
      KomgaMeController,
      KomgaLibraryController,
      KomgaSeriesController,
      KomgaBookController,
      KomgaReferentialController,
      KomgaReadProgressController,
      KomgaListController,
      KomgaOpdsController,
      KomgaFallbackController,
    ]);
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, KomgaModule)).toEqual([
      KomgaUserRepository,
      KomgaUserService,
      KomgaAuthGuard,
      KomgaEnabledGuard,
      KomgaCatalogRepository,
      KomgaLibraryService,
      KomgaBookService,
      KomgaSeriesService,
      KomgaReferentialService,
      KomgaReadProgressService,
      KomgaThumbnailService,
      KomgaOpdsService,
    ]);
  });
});
