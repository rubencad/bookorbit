import fs from 'fs';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { buildStoredRarArchive } from '../../../../test/e2e/comics/rar-stored-archive';
import { listCbrPages } from './cbr-pages';

const REPEATS = 100;

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

  it('does not leak file descriptors when listing succeeds or fails', async () => {
    const openSpy = vi.spyOn(fs, 'openSync');
    const closeSpy = vi.spyOn(fs, 'closeSync');
    try {
      for (let attempt = 0; attempt < REPEATS; attempt++) {
        await listCbrPages(readablePath);
        await expect(listCbrPages(lockedPath)).rejects.toThrow('CBR archive is password protected');
      }

      const archiveDescriptors = openSpy.mock.calls.flatMap((call, index) =>
        call[0] === readablePath || call[0] === lockedPath ? [openSpy.mock.results[index].value as number] : [],
      );
      const closedDescriptors = new Set(closeSpy.mock.calls.map((call) => call[0]));

      expect(archiveDescriptors).toHaveLength(2 * REPEATS);
      expect(archiveDescriptors.filter((descriptor) => !closedDescriptors.has(descriptor))).toEqual([]);
    } finally {
      openSpy.mockRestore();
      closeSpy.mockRestore();
    }
  });
});
