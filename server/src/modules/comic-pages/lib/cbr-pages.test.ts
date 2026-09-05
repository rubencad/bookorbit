import { existsSync, readdirSync } from 'fs';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { buildStoredRarArchive } from '../../../../test/e2e/comics/rar-stored-archive';
import { listCbrPages } from './cbr-pages';

const REPEATS = 100;

function openDescriptors(): number {
  return readdirSync('/dev/fd').length;
}

describe('listCbrPages', () => {
  let root: string;
  let readablePath: string;
  let lockedPath: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'cbr-pages-'));
    readablePath = join(root, 'readable.cbr');
    lockedPath = join(root, 'locked.cbr');
    await writeFile(
      readablePath,
      buildStoredRarArchive([
        { name: 'pages/002.jpg', data: Buffer.from('two') },
        { name: 'pages/001.png', data: Buffer.from('one') },
      ]),
    );
    await writeFile(
      lockedPath,
      buildStoredRarArchive([
        { name: 'pages/001.png', data: Buffer.from('one') },
        { name: 'pages/002.jpg', data: Buffer.from('two'), encrypted: true },
      ]),
    );
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('lists pages with their unpacked sizes', async () => {
    await expect(listCbrPages(readablePath)).resolves.toEqual([
      { index: 0, entryName: 'pages/001.png', mimeType: 'image/png', sizeBytes: 3 },
      { index: 1, entryName: 'pages/002.jpg', mimeType: 'image/jpeg', sizeBytes: 3 },
    ]);
  });

  it('rejects archives with a password protected entry', async () => {
    await expect(listCbrPages(lockedPath)).rejects.toThrow('CBR archive is password protected');
  });

  it.skipIf(!existsSync('/dev/fd'))('does not leak file descriptors when listing succeeds or fails', async () => {
    const before = openDescriptors();

    for (let attempt = 0; attempt < REPEATS; attempt++) {
      await listCbrPages(readablePath);
      await expect(listCbrPages(lockedPath)).rejects.toThrow('CBR archive is password protected');
    }

    expect(openDescriptors()).toBeLessThan(before + REPEATS);
  });
});
