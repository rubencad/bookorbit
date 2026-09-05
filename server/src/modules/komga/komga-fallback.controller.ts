import { All, Controller, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { Public } from '../../common/decorators/public.decorator';

@Controller('komga')
@Public()
export class KomgaFallbackController {
  @All('*')
  notFound(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    reply.status(404).send({
      timestamp: new Date().toISOString(),
      status: 404,
      error: 'Not Found',
      message: 'This Komga endpoint is not provided by BookOrbit',
      path: request.url.split('?')[0],
    });
  }
}
