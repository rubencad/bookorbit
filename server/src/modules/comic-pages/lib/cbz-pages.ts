import { createCbzZipEntryReadStream, isSupportedCbzZipCompression, readCbzZipIndex } from '../../../common/cbz-zip-reader';
import { ComicArchiveError } from './comic-archive-error';
import { toComicPageEntries, type ComicPageEntry } from './comic-page-entry';

export async function listCbzPages(absolutePath: string): Promise<ComicPageEntry[]> {
  const index = await readCbzZipIndex(absolutePath);
  if (!index) throw new ComicArchiveError('CBZ archive is unreadable');

  return toComicPageEntries(
    index.entries
      .filter((entry) => isSupportedCbzZipCompression(entry) && entry.compressedSize > 0)
      .map((entry) => ({ entryName: entry.name, sizeBytes: entry.uncompressedSize, cbzEntry: entry })),
  );
}

export function streamCbzPage(absolutePath: string, page: ComicPageEntry): NodeJS.ReadableStream {
  if (!page.cbzEntry) throw new ComicArchiveError('CBZ page has no archive entry');
  return createCbzZipEntryReadStream(absolutePath, page.cbzEntry);
}
