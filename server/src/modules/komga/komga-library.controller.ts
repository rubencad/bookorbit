import { Get, NotFoundException, Param } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { parseNumericId } from './komga-ids';
import { KomgaLibraryService } from './komga-library.service';
import { KomgaController } from './komga-public.controller';
import { toKomgaLibraryDto } from './komga.mapper';

@KomgaController('komga/api/v1/libraries')
export class KomgaLibraryController {
  constructor(private readonly libraryService: KomgaLibraryService) {}

  @Get()
  async list(@CurrentUser() user: RequestUser) {
    const libraries = await this.libraryService.listLibraries(user);
    return libraries.map(toKomgaLibraryDto);
  }

  @Get(':libraryId')
  async get(@CurrentUser() user: RequestUser, @Param('libraryId') libraryIdParam: string) {
    const libraryId = parseNumericId(libraryIdParam);
    if (libraryId === null) throw new NotFoundException('Library not found');
    return toKomgaLibraryDto(await this.libraryService.getLibrary(user, libraryId));
  }
}
