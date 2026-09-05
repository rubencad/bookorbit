import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import type { FastifyReply } from 'fastify';

import { bookThumbnailPath } from '../../common/book-cover-storage';

@Injectable()
export class KomgaThumbnailService {
  private readonly appDataPath: string;

  constructor(config: ConfigService) {
    this.appDataPath = config.get<string>('storage.appDataPath')!;
  }

  async send(bookId: number, reply: FastifyReply, ifNoneMatch?: string): Promise<void> {
    const thumbnailPath = bookThumbnailPath(this.appDataPath, bookId);
    let mtimeMs: number;
    try {
      ({ mtimeMs } = await stat(thumbnailPath));
    } catch {
      throw new NotFoundException('No thumbnail');
    }
    const etag = `"${Math.floor(mtimeMs)}"`;
    if (ifNoneMatch === etag) {
      reply.status(304).send();
      return;
    }
    reply.header('Cache-Control', 'no-cache');
    reply.header('ETag', etag);
    reply.type('image/jpeg');
    reply.send(createReadStream(thumbnailPath));
  }
}
