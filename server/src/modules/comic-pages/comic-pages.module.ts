import { Module } from '@nestjs/common';

import { ComicPageRepository } from './comic-page.repository';
import { ComicPageService } from './comic-page.service';

@Module({
  providers: [ComicPageService, ComicPageRepository],
  exports: [ComicPageService],
})
export class ComicPagesModule {}
