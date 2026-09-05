import { createReadStream } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createExtractorFromFile, UnrarError, type FileHeader } from 'node-unrar-js';

import { ComicArchiveError } from './comic-archive-error';
import { toComicPageEntries, type ComicPageEntry } from './comic-page-entry';

const EXTRACTED_PAGE_FILENAME = 'page';

function isUnrarError(error: unknown): error is Error {
  if (typeof UnrarError === 'function' && error instanceof UnrarError) return true;
  if (!(error instanceof Error)) return false;
  const reason = (error as Error & { reason?: unknown }).reason;
  return typeof reason === 'string' && reason.startsWith('ERAR_');
}

// node-unrar-js closes the archive only after this generator is exhausted.
function readFileHeaders(fileHeaders: Iterable<FileHeader>): FileHeader[] {
  const headers: FileHeader[] = [];
  try {
    for (const header of fileHeaders) headers.push(header);
  } catch (error) {
    // Some RAR 1.5 files report ERAR_BAD_DATA at EOF after yielding valid headers.
    if (!isUnrarError(error) || headers.length === 0) throw error;
  }
  return headers;
}

export async function listCbrPages(absolutePath: string): Promise<ComicPageEntry[]> {
  let headerEncrypted: boolean;
  let headers: FileHeader[];

  try {
    const extractor = await createExtractorFromFile({ filepath: absolutePath });
    const { arcHeader, fileHeaders } = extractor.getFileList();
    headerEncrypted = arcHeader.flags.headerEncrypted;
    headers = readFileHeaders(fileHeaders);
  } catch (error) {
    if (isUnrarError(error)) throw new ComicArchiveError(`CBR archive is unreadable: ${error.message}`);
    throw error;
  }

  if (headerEncrypted || headers.some((header) => header.flags.encrypted)) {
    throw new ComicArchiveError('CBR archive is password protected');
  }

  return toComicPageEntries(
    headers.filter((header) => !header.flags.directory).map((header) => ({ entryName: header.name, sizeBytes: header.unpSize })),
  );
}

export async function extractCbrPage(absolutePath: string, page: ComicPageEntry): Promise<NodeJS.ReadableStream> {
  const targetDirectory = await mkdtemp(join(tmpdir(), 'bookorbit-cbr-'));
  const removeTargetDirectory = (): void => {
    void rm(targetDirectory, { recursive: true, force: true }).catch(() => undefined);
  };

  try {
    const extractor = await createExtractorFromFile({
      filepath: absolutePath,
      targetPath: targetDirectory,
      filenameTransform: () => EXTRACTED_PAGE_FILENAME,
    });
    // Passing the page name stops extraction before the bad EOF marker in some RAR 1.5 files.
    const { files } = extractor.extract({ files: [page.entryName] });
    let extracted = false;
    for (const file of files) {
      if (!file.fileHeader.flags.directory) extracted = true;
    }
    if (!extracted) throw new ComicArchiveError(`CBR page is unreadable: entry ${page.entryName} is missing`);

    const stream = createReadStream(join(targetDirectory, EXTRACTED_PAGE_FILENAME));
    stream.once('close', removeTargetDirectory);
    return stream;
  } catch (error) {
    removeTargetDirectory();
    if (isUnrarError(error)) throw new ComicArchiveError(`CBR page is unreadable: ${error.message}`);
    throw error;
  }
}
