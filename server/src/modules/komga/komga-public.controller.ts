import { applyDecorators, Controller, UseGuards } from '@nestjs/common';

import { Public } from '../../common/decorators/public.decorator';
import { KomgaAuthGuard } from './komga-auth.guard';
import { KomgaEnabledGuard } from './komga-enabled.guard';

export function KomgaController(path: string) {
  return applyDecorators(Controller(path), Public(), UseGuards(KomgaEnabledGuard, KomgaAuthGuard));
}
