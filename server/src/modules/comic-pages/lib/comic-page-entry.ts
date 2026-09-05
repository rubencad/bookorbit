import type { CbzZipEntry } from '../../../common/cbz-zip-reader';
import { imageContentTypeFromPath } from '../../../common/image-content-type';

export interface ComicPageEntry {
  index: number;
  entryName: string;
  mimeType: string;
  sizeBytes: number;
  cbzEntry?: CbzZipEntry;
}

interface ComicPageCandidate {
  entryName: string;
  sizeBytes: number;
  cbzEntry?: CbzZipEntry;
}

const PAGE_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif']);
const MACOS_RESOURCE_FORK_DIRECTORY = '__MACOSX';

export function isComicPageEntryName(entryName: string): boolean {
  if (entryName.endsWith('/')) return false;
  const segments = entryName.split('/');
  if (segments.some((segment) => segment.startsWith('.') || segment === MACOS_RESOURCE_FORK_DIRECTORY)) return false;
  const dot = entryName.lastIndexOf('.');
  return dot !== -1 && PAGE_IMAGE_EXTENSIONS.has(entryName.substring(dot).toLowerCase());
}

export function compareComicEntryNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export function toComicPageEntries(candidates: readonly ComicPageCandidate[]): ComicPageEntry[] {
  return candidates
    .filter((candidate) => isComicPageEntryName(candidate.entryName))
    .sort((a, b) => compareComicEntryNames(a.entryName, b.entryName))
    .map((candidate, index) => ({ ...candidate, index, mimeType: imageContentTypeFromPath(candidate.entryName) }));
}

export function uniformComicPageMediaType(pages: readonly ComicPageEntry[]): string | null {
  const first = pages[0]?.mimeType;
  if (first === undefined) return null;
  return pages.every((page) => page.mimeType === first) ? first : null;
}
