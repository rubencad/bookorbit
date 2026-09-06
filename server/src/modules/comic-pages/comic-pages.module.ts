import { Module } from '@nestjs/common';

import { ComicPageBackfillService } from './comic-page-backfill.service';
import { ComicPageRepository } from './comic-page.repository';
import { ComicPageService } from './comic-page.service';

@Module({
  providers: [ComicPageService, ComicPageRepository, ComicPageBackfillService],
  exports: [ComicPageService],
})
export class ComicPagesModule {}
