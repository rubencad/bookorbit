import { BadRequestException, Get, Param, Query } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { KomgaAccount } from './komga-account.decorator';
import type { KomgaRequestAccount } from './komga-auth.guard';
import { KomgaBookService } from './komga-book.service';
import { parseNumericId } from './komga-ids';
import { KomgaController } from './komga-public.controller';
import { bookListQuerySchema, parseKomgaQuery, type KomgaRawQuery } from './komga-query';

@KomgaController('komga/api/v1/books')
export class KomgaBookController {
  constructor(private readonly bookService: KomgaBookService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Query() query: KomgaRawQuery) {
    return this.bookService.list(user, account, parseKomgaQuery(bookListQuerySchema, query));
  }

  @Get(':bookId')
  get(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Param('bookId') bookIdParam: string) {
    return this.bookService.get(user, account, this.parseBookId(bookIdParam));
  }

  private parseBookId(value: string): number {
    const bookId = parseNumericId(value);
    if (bookId === null) throw new BadRequestException('Book id must be a positive integer');
    return bookId;
  }
}
