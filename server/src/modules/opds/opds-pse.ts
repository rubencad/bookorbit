import type { ComicPageImageFormat } from '../comic-pages/comic-page.service';

export const OPDS_PSE_NAMESPACE = 'http://vaemendis.net/opds-pse/ns';
export const OPDS_PSE_STREAM_REL = 'http://vaemendis.net/opds-pse/stream';

const PSE_STREAM_FORMATS: ReadonlySet<string> = new Set<ComicPageImageFormat>(['jpeg', 'png']);

// A PSE link declares one type for the whole archive. Use JPEG for mixed or unsupported pages.
export function pseStreamFormat(pageMediaType: string | null): ComicPageImageFormat {
  return pageMediaType === 'image/png' ? 'png' : 'jpeg';
}

export function pseStreamType(format: ComicPageImageFormat): string {
  return `image/${format}`;
}

export function isPseStreamFormat(value: string): value is ComicPageImageFormat {
  return PSE_STREAM_FORMATS.has(value);
}

export function pseConversionFor(format: ComicPageImageFormat, pageMimeType: string): ComicPageImageFormat | undefined {
  return pageMimeType === pseStreamType(format) ? undefined : format;
}
