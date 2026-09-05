import { Get } from '@nestjs/common';

import { KomgaController } from './komga-public.controller';
import { emptyKomgaPage } from './komga-page-response';

@KomgaController('komga/api/v1')
export class KomgaListController {
  @Get('collections')
  collections() {
    return emptyKomgaPage();
  }

  @Get('readlists')
  readlists() {
    return emptyKomgaPage();
  }
}
