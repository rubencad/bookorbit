import { Module } from '@nestjs/common';
import { BookModule } from '../../book/book.module';
import { ComicPagesModule } from '../../comic-pages/comic-pages.module';
import { CbzController } from './cbz.controller';
import { CbzService } from './cbz.service';

@Module({
  imports: [BookModule, ComicPagesModule],
  controllers: [CbzController],
  providers: [CbzService],
})
export class CbzModule {}
