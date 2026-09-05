import { basename, dirname } from 'path';

import { createSevenZipTempId, getSevenZip, runSevenZip, type SevenZipModule } from '../../../common/sevenzip';
import { ComicArchiveError } from './comic-archive-error';
import { toComicPageEntries, type ComicPageEntry } from './comic-page-entry';

interface SevenZipListedEntry {
  path: string;
  sizeBytes: number;
  directory: boolean;
  encrypted: boolean;
}

interface MountedArchive {
  archivePath: string;
  release: () => void;
}

// Mount the parent directory so 7-Zip can read the archive without copying it into WASM memory.
function mountArchiveDirectory(sevenZip: SevenZipModule, absolutePath: string): MountedArchive {
  const mountPoint = `/${createSevenZipTempId('comic')}`;
  sevenZip.FS.mkdir(mountPoint);
  sevenZip.FS.mount(sevenZip.NODEFS, { root: dirname(absolutePath) }, mountPoint);

  return {
    archivePath: `${mountPoint}/${basename(absolutePath)}`,
    release: () => {
      try {
        sevenZip.FS.unmount(mountPoint);
      } catch {
        // already unmounted
      }
      try {
        sevenZip.FS.rmdir(mountPoint);
      } catch {
        // already removed
      }
    },
  };
}

function removeDirectory(sevenZip: SevenZipModule, directory: string): void {
  try {
    for (const name of sevenZip.FS.readdir(directory)) {
      if (name === '.' || name === '..') continue;
      sevenZip.FS.unlink(`${directory}/${name}`);
    }
    sevenZip.FS.rmdir(directory);
  } catch {
    // directory may not exist or may already be removed
  }
}

export function parseSevenZipListing(lines: readonly string[]): SevenZipListedEntry[] {
  const entries: SevenZipListedEntry[] = [];
  let current: Partial<Record<string, string>> | null = null;

  const flush = (): void => {
    if (current?.Path !== undefined) {
      entries.push({
        path: current.Path,
        sizeBytes: Number.parseInt(current.Size ?? '', 10) || 0,
        directory: (current.Attributes ?? '').startsWith('D'),
        encrypted: current.Encrypted === '+',
      });
    }
    current = null;
  };

  for (const line of lines) {
    const separator = line.indexOf(' = ');
    if (separator === -1) {
      if (line.trim() === '') flush();
      continue;
    }
    const key = line.slice(0, separator);
    const value = line.slice(separator + 3);
    if (key === 'Path') flush();
    current ??= {};
    current[key] = value;
  }
  flush();

  return entries;
}

function firstErrorLine(stderr: readonly string[]): string | null {
  const line = stderr.find((candidate) => candidate.includes('ERROR'));
  return line ? line.replace(/^ERROR:\s*/, '').trim() : null;
}

export async function listCb7Pages(absolutePath: string): Promise<ComicPageEntry[]> {
  const sevenZip = await getSevenZip();
  const mounted = mountArchiveDirectory(sevenZip, absolutePath);

  try {
    const result = runSevenZip(sevenZip, ['l', '-slt', '-ba', '-bsp0', '--', mounted.archivePath]);
    const failure = firstErrorLine(result.stderr);
    if (result.exitError !== null || failure !== null) {
      throw new ComicArchiveError(`CB7 archive is unreadable${failure ? `: ${failure}` : ''}`);
    }

    const listed = parseSevenZipListing(result.stdout);
    if (listed.some((entry) => entry.encrypted)) throw new ComicArchiveError('CB7 archive is password protected');

    return toComicPageEntries(listed.filter((entry) => !entry.directory).map((entry) => ({ entryName: entry.path, sizeBytes: entry.sizeBytes })));
  } finally {
    mounted.release();
  }
}

export async function extractCb7Page(absolutePath: string, page: ComicPageEntry): Promise<Buffer> {
  const sevenZip = await getSevenZip();
  const mounted = mountArchiveDirectory(sevenZip, absolutePath);
  const outputDirectory = `/${createSevenZipTempId('comic_out')}`;
  sevenZip.FS.mkdir(outputDirectory);

  try {
    const result = runSevenZip(sevenZip, ['e', mounted.archivePath, `-o${outputDirectory}`, '-spd', '-y', '-bsp0', '-bso0', '--', page.entryName]);
    let bytes: Uint8Array;
    try {
      bytes = sevenZip.FS.readFile(`${outputDirectory}/${basename(page.entryName)}`);
    } catch {
      const failure = firstErrorLine(result.stderr);
      throw new ComicArchiveError(`CB7 page is unreadable: ${failure ?? `entry ${page.entryName} is missing`}`);
    }
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  } finally {
    removeDirectory(sevenZip, outputDirectory);
    mounted.release();
  }
}
