import 'reflect-metadata';

import { ComicPageRepository } from './comic-page.repository';
import { ComicPageService } from './comic-page.service';
import { ComicPagesModule } from './comic-pages.module';

describe('ComicPagesModule', () => {
  it('provides the page service and repository and exports only the service', () => {
    expect(Reflect.getMetadata('providers', ComicPagesModule)).toEqual([ComicPageService, ComicPageRepository]);
    expect(Reflect.getMetadata('exports', ComicPagesModule)).toEqual([ComicPageService]);
  });
});
