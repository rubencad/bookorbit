import { mkdir, writeFile } from 'fs/promises';
import { dirname, isAbsolute, join, normalize } from 'path';

import { createSevenZipTempId, getSevenZip, runSevenZip, type SevenZipModule } from '../../../src/common/sevenzip';
import { createZipArchiveFixture } from '../metadata-write/metadata-write-fixture-builder';
import { buildStoredRarArchive } from './rar-stored-archive';

export interface ComicFixtureEntry {
  path: string;
  content: string | Buffer;
  store?: boolean;
}

export const COMIC_PAGE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cQpUAAAAASUVORK5CYII=', 'base64');
export const COMIC_PAGE_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBAQEA8QEA8QDw8QEA8PDw8QFREWFhURFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMsNygtLisBCgoKDg0OGhAQGy0lICUtLS8tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAgMBEQACEQEDEQH/xAAXAAEBAQEAAAAAAAAAAAAAAAABAgME/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEAMQAAAB6A//xAAYEAEAAwEAAAAAAAAAAAAAAAABABEhMf/aAAgBAQABBQJXJZ//xAAVEQEBAAAAAAAAAAAAAAAAAAABAP/aAAgBAwEBPwGn/8QAFREBAQAAAAAAAAAAAAAAAAAAARD/2gAIAQIBAT8Bp//EABgQAQADAQAAAAAAAAAAAAAAAAEAESEx/9oACAEBAAY/AhGQx//EABsQAQABBQEAAAAAAAAAAAAAAAERACExQVFh/9oACAEBAAE/IV2K4zGq4Jm1q//aAAwDAQACAAMAAAAQ8//EABcRAQEBAQAAAAAAAAAAAAAAAAEREDH/2gAIAQMBAT8Qw0f/xAAWEQEBAQAAAAAAAAAAAAAAAAABEBH/2gAIAQIBAT8QkL//xAAbEAEBAQADAQEAAAAAAAAAAAABEQAhMUFhcf/aAAgBAQABPxC4oLQ1M8JrIoYNewc19hXtOD87mpy4V/mQJu1WDVYj1WFJsbgx5caX//Z',
  'base64',
);

function assertRelativePath(relativePath: string): void {
  const normalized = normalize(relativePath);
  if (isAbsolute(relativePath) || normalized === '..' || normalized.startsWith('../') || normalized.startsWith('..\\')) {
    throw new Error(`Fixture paths must be relative. Received "${relativePath}"`);
  }
}

function toBuffer(content: string | Buffer): Buffer {
  return typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
}

async function writeFixture(rootPath: string, relativePath: string, bytes: Buffer): Promise<string> {
  assertRelativePath(relativePath);
  const absolutePath = join(rootPath, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);
  return absolutePath;
}

export async function createCbzComicFixture(rootPath: string, relativePath: string, entries: readonly ComicFixtureEntry[]): Promise<string> {
  return createZipArchiveFixture(rootPath, relativePath, [...entries]);
}

export async function createCbrComicFixture(rootPath: string, relativePath: string, entries: readonly ComicFixtureEntry[]): Promise<string> {
  const archive = buildStoredRarArchive(entries.map((entry) => ({ name: entry.path, data: toBuffer(entry.content) })));
  return writeFixture(rootPath, relativePath, archive);
}

export async function createCb7ComicFixture(rootPath: string, relativePath: string, entries: readonly ComicFixtureEntry[]): Promise<string> {
  return writeFixture(rootPath, relativePath, await buildCb7Archive(entries));
}

export async function buildCb7Archive(entries: readonly ComicFixtureEntry[]): Promise<Buffer> {
  const sevenZip = await getSevenZip();
  const stagingDirectory = `/${createSevenZipTempId('fixture')}`;
  const archivePath = `${stagingDirectory}.cb7`;
  sevenZip.FS.mkdir(stagingDirectory);

  try {
    const topLevelNames = new Set<string>();
    const createdDirectories = new Set<string>();
    for (const entry of entries) {
      const segments = entry.path.split('/');
      topLevelNames.add(segments[0]);
      ensureDirectories(sevenZip, stagingDirectory, segments.slice(0, -1), createdDirectories);
      const bytes = toBuffer(entry.content);
      const fd = sevenZip.FS.open(`${stagingDirectory}/${entry.path}`, 'w+');
      sevenZip.FS.write(fd, bytes, 0, bytes.length);
      sevenZip.FS.close(fd);
    }

    const result = runSevenZip(sevenZip, [
      'a',
      archivePath,
      ...[...topLevelNames].map((name) => `${stagingDirectory}/${name}`),
      '-y',
      '-bsp0',
      '-bso0',
    ]);
    if (result.exitError !== null || result.stderr.some((line) => line.includes('ERROR'))) {
      throw new Error(`Could not build CB7 fixture: ${result.stderr.join(' ')}`);
    }
    return Buffer.from(sevenZip.FS.readFile(archivePath));
  } finally {
    removeTree(sevenZip, stagingDirectory);
    if (sevenZip.FS.readdir('/').includes(archivePath.slice(1))) sevenZip.FS.unlink(archivePath);
  }
}

function ensureDirectories(sevenZip: SevenZipModule, root: string, segments: readonly string[], createdDirectories: Set<string>): void {
  let current = root;
  for (const segment of segments) {
    current = `${current}/${segment}`;
    if (createdDirectories.has(current)) continue;
    sevenZip.FS.mkdir(current);
    createdDirectories.add(current);
  }
}

function removeTree(sevenZip: SevenZipModule, directory: string): void {
  const names = sevenZip.FS.readdir(directory).filter((name) => name !== '.' && name !== '..');
  for (const name of names) {
    const child = `${directory}/${name}`;
    if (sevenZip.FS.isDir(sevenZip.FS.stat(child).mode)) removeTree(sevenZip, child);
    else sevenZip.FS.unlink(child);
  }
  sevenZip.FS.rmdir(directory);
}
