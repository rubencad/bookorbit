import type { ComicPageImageFormat } from '../comic-pages/comic-page.service';

export const OPDS_PSE_NAMESPACE = 'http://vaemendis.net/opds-pse/ns';
export const OPDS_PSE_STREAM_REL = 'http://vaemendis.net/opds-pse/stream';

export type OpdsPseStreamType = 'image/jpeg' | 'image/png';

// One stream link describes every page of a comic, so only an archive whose pages already share a
// type the extension permits streams natively; every other archive is served as JPEG.
export function pseStreamType(pageMediaType: string | null): OpdsPseStreamType {
  return pageMediaType === 'image/png' ? 'image/png' : 'image/jpeg';
}

export function pseConversionFor(streamType: OpdsPseStreamType, pageMimeType: string): ComicPageImageFormat | undefined {
  if (pageMimeType === streamType) return undefined;
  return streamType === 'image/png' ? 'png' : 'jpeg';
}
