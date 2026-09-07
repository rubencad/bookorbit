import { Controller, HttpCode, HttpStatus, Post, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { Public } from '../../common/decorators/public.decorator';
import { KomgaEnabledGuard } from './komga-enabled.guard';
import { KomgaRememberMeService } from './komga-remember-me.service';

@Controller('komga/api')
@Public()
@UseGuards(KomgaEnabledGuard)
export class KomgaLogoutController {
  constructor(private readonly rememberMe: KomgaRememberMeService) {}

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) reply: FastifyReply): void {
    this.rememberMe.clear(reply);
  }
}
