import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import type { FastifyReply } from 'fastify';

import { contentDispositionHeader } from '../../common/utils/content-disposition.utils';
import { contentRangeHeader, resolveByteRange, unsatisfiableContentRangeHeader } from '../../common/utils/http-range.utils';
import type { KomgaPageImage } from './komga-book.service';
import type { KomgaBookFileRecord } from './komga-catalog.types';
import { komgaMediaType } from './komga.mapper';

export function sendKomgaPageImage(image: KomgaPageImage, reply: FastifyReply, ifNoneMatch?: string): void {
  reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
  if (ifNoneMatch === image.etag) {
    reply.status(304).send();
    return;
  }
  reply.header('Cache-Control', 'private, max-age=86400');
  reply.header('ETag', image.etag);
  reply.type(image.stream.mimeType);
  reply.send(image.stream.stream);
}

export async function sendKomgaBookFile(
  download: { file: KomgaBookFileRecord; filename: string },
  reply: FastifyReply,
  rangeHeader?: string,
): Promise<void> {
  const { file, filename } = download;
  const { size } = await stat(file.absolutePath);

  reply.header('Accept-Ranges', 'bytes');
  reply.header('Content-Disposition', contentDispositionHeader('attachment', filename, 'download'));
  reply.type(komgaMediaType(file.format));

  const resolution = resolveByteRange(rangeHeader, size);
  if (resolution.kind === 'unsatisfiable') {
    reply.header('Content-Range', unsatisfiableContentRangeHeader(size));
    reply.status(416).send();
    return;
  }
  if (resolution.kind === 'partial') {
    const { start, end } = resolution.range;
    reply.header('Content-Range', contentRangeHeader(resolution.range, size));
    reply.header('Content-Length', end - start + 1);
    reply.status(206).send(createReadStream(file.absolutePath, { start, end }));
    return;
  }
  reply.header('Content-Length', size);
  reply.send(createReadStream(file.absolutePath));
}
