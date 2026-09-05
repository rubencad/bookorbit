import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import type { KomgaRequestAccount } from './komga-auth.guard';

export const KomgaAccount = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): KomgaRequestAccount => ctx.switchToHttp().getRequest<{ komgaAccount: KomgaRequestAccount }>().komgaAccount,
);
