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
    const events: Array<{ kind: 'open' | 'close'; descriptor: number }> = [];
    const realOpen = fs.openSync;
    const realClose = fs.closeSync;
    const openSpy = vi.spyOn(fs, 'openSync').mockImplementation((path, flags, mode) => {
      const descriptor = realOpen(path, flags, mode);
      if (path === readablePath || path === lockedPath) events.push({ kind: 'open', descriptor });
      return descriptor;
    });
    const closeSpy = vi.spyOn(fs, 'closeSync').mockImplementation((descriptor) => {
      events.push({ kind: 'close', descriptor });
      realClose(descriptor);
    });

    try {
      for (let attempt = 0; attempt < REPEATS; attempt++) {
        await listCbrPages(readablePath);
        await expect(listCbrPages(lockedPath)).rejects.toThrow('CBR archive is password protected');
      }
    } finally {
      openSpy.mockRestore();
      closeSpy.mockRestore();
    }

    // Descriptor numbers are recycled, so each open must be matched to the close that follows it.
    const stillOpen = new Set<number>();
    let opens = 0;
    for (const { kind, descriptor } of events) {
      if (kind === 'close') {
        stillOpen.delete(descriptor);
        continue;
      }
      opens++;
      stillOpen.add(descriptor);
    }

    expect(opens).toBe(2 * REPEATS);
    expect([...stillOpen]).toEqual([]);
  });
});
