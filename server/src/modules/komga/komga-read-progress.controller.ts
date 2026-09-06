import { BadRequestException, Body, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { KomgaAccount } from './komga-account.decorator';
import type { KomgaRequestAccount } from './komga-auth.guard';
import { parseNumericId } from './komga-ids';
import { KomgaController } from './komga-public.controller';
import { parseKomgaBody, readProgressUpdateSchema, tachiyomiProgressUpdateV1Schema, tachiyomiProgressUpdateV2Schema } from './komga-query';
import { KomgaReadProgressService } from './komga-read-progress.service';

@KomgaController('komga/api')
export class KomgaReadProgressController {
  constructor(private readonly readProgressService: KomgaReadProgressService) {}

  @Patch('v1/books/:bookId/read-progress')
  @HttpCode(HttpStatus.NO_CONTENT)
  async updateBook(
    @CurrentUser() user: RequestUser,
    @KomgaAccount() account: KomgaRequestAccount,
    @Param('bookId') bookIdParam: string,
    @Body() body: unknown,
  ) {
    await this.readProgressService.updateBook(user, account, this.parseBookId(bookIdParam), parseKomgaBody(readProgressUpdateSchema, body));
  }

  @Delete('v1/books/:bookId/read-progress')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearBook(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Param('bookId') bookIdParam: string) {
    await this.readProgressService.clearBook(user, account, this.parseBookId(bookIdParam));
  }

  @Post('v1/series/:seriesId/read-progress')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markSeriesRead(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Param('seriesId') seriesId: string) {
    await this.readProgressService.markSeriesRead(user, account, seriesId);
  }

  @Delete('v1/series/:seriesId/read-progress')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearSeries(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Param('seriesId') seriesId: string) {
    await this.readProgressService.clearSeries(user, account, seriesId);
  }

  @Get('v1/series/:seriesId/read-progress/tachiyomi')
  tachiyomiV1(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Param('seriesId') seriesId: string) {
    return this.readProgressService.tachiyomiProgressV1(user, account, seriesId);
  }

  @Put('v1/series/:seriesId/read-progress/tachiyomi')
  @HttpCode(HttpStatus.NO_CONTENT)
  async updateTachiyomiV1(
    @CurrentUser() user: RequestUser,
    @KomgaAccount() account: KomgaRequestAccount,
    @Param('seriesId') seriesId: string,
    @Body() body: unknown,
  ) {
    const { lastBookRead } = parseKomgaBody(tachiyomiProgressUpdateV1Schema, body);
    await this.readProgressService.markReadUpToIndex(user, account, seriesId, lastBookRead);
  }

  @Get('v2/series/:seriesId/read-progress/tachiyomi')
  tachiyomiV2(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount, @Param('seriesId') seriesId: string) {
    return this.readProgressService.tachiyomiProgressV2(user, account, seriesId);
  }

  @Put('v2/series/:seriesId/read-progress/tachiyomi')
  @HttpCode(HttpStatus.NO_CONTENT)
  async updateTachiyomiV2(
    @CurrentUser() user: RequestUser,
    @KomgaAccount() account: KomgaRequestAccount,
    @Param('seriesId') seriesId: string,
    @Body() body: unknown,
  ) {
    const { lastBookNumberSortRead } = parseKomgaBody(tachiyomiProgressUpdateV2Schema, body);
    await this.readProgressService.markReadUpToNumberSort(user, account, seriesId, lastBookNumberSortRead);
  }

  private parseBookId(value: string): number {
    const bookId = parseNumericId(value);
    if (bookId === null) throw new BadRequestException('Book id must be a positive integer');
    return bookId;
  }
}
