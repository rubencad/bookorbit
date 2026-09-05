import { Get } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { KomgaAccount } from './komga-account.decorator';
import type { KomgaRequestAccount } from './komga-auth.guard';
import { KomgaLibraryService } from './komga-library.service';
import { KomgaController } from './komga-public.controller';
import { toKomgaUserDto } from './komga.mapper';

@KomgaController('komga/api')
export class KomgaMeController {
  constructor(private readonly libraryService: KomgaLibraryService) {}

  @Get('v2/users/me')
  async meV2(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount) {
    return toKomgaUserDto(account, user, await this.libraryService.accessibleLibraryIds(user));
  }

  @Get('v1/users/me')
  async meV1(@CurrentUser() user: RequestUser, @KomgaAccount() account: KomgaRequestAccount) {
    return toKomgaUserDto(account, user, await this.libraryService.accessibleLibraryIds(user));
  }
}
