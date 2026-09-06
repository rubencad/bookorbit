import 'reflect-metadata';

import { ComicPageBackfillService } from './comic-page-backfill.service';
import { ComicPageRepository } from './comic-page.repository';
import { ComicPageService } from './comic-page.service';
import { ComicPagesModule } from './comic-pages.module';

describe('ComicPagesModule', () => {
  it('provides the page service, repository and startup backfill and exports only the service', () => {
    expect(Reflect.getMetadata('providers', ComicPagesModule)).toEqual([ComicPageService, ComicPageRepository, ComicPageBackfillService]);
    expect(Reflect.getMetadata('exports', ComicPagesModule)).toEqual([ComicPageService]);
  });
});
