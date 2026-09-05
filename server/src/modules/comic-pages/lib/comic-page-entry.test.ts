import { isComicPageEntryName, sharedComicPageMediaType, toComicPageEntries } from './comic-page-entry';

describe('isComicPageEntryName', () => {
  it('accepts image files anywhere in the tree', () => {
    expect(isComicPageEntryName('001.jpg')).toBe(true);
    expect(isComicPageEntryName('pages/002.PNG')).toBe(true);
    expect(isComicPageEntryName('a/b/c/003.webp')).toBe(true);
    expect(isComicPageEntryName('004.avif')).toBe(true);
  });

  it('rejects directories, hidden paths, macOS resource forks and non-images', () => {
    expect(isComicPageEntryName('pages/')).toBe(false);
    expect(isComicPageEntryName('.hidden/001.jpg')).toBe(false);
    expect(isComicPageEntryName('pages/._001.jpg')).toBe(false);
    expect(isComicPageEntryName('__MACOSX/pages/001.jpg')).toBe(false);
    expect(isComicPageEntryName('ComicInfo.xml')).toBe(false);
    expect(isComicPageEntryName('notes/readme.txt')).toBe(false);
    expect(isComicPageEntryName('noextension')).toBe(false);
  });
});

describe('toComicPageEntries', () => {
  it('filters to pages, sorts naturally and numbers from zero with mime types', () => {
    const entries = toComicPageEntries([
      { entryName: 'pages/010.jpg', sizeBytes: 10 },
      { entryName: 'pages/2.png', sizeBytes: 2 },
      { entryName: 'ComicInfo.xml', sizeBytes: 1 },
      { entryName: '.hidden/1.png', sizeBytes: 1 },
      { entryName: 'pages/1.webp', sizeBytes: 3 },
    ]);

    expect(entries).toEqual([
      { index: 0, entryName: 'pages/1.webp', sizeBytes: 3, mimeType: 'image/webp' },
      { index: 1, entryName: 'pages/2.png', sizeBytes: 2, mimeType: 'image/png' },
      { index: 2, entryName: 'pages/010.jpg', sizeBytes: 10, mimeType: 'image/jpeg' },
    ]);
  });

  it('keeps archive-specific entry data on the page', () => {
    const cbzEntry = { name: 'a.jpg', compression: 8, compressedSize: 5, uncompressedSize: 9, localHeaderOffset: 0, dataStart: 30 };
    expect(toComicPageEntries([{ entryName: 'a.jpg', sizeBytes: 9, cbzEntry }])[0].cbzEntry).toBe(cbzEntry);
  });
});

describe('sharedComicPageMediaType', () => {
  it('returns the shared type when every page has the same media type', () => {
    const pages = toComicPageEntries([
      { entryName: '002.JPG', sizeBytes: 1 },
      { entryName: '001.jpeg', sizeBytes: 1 },
    ]);
    expect(sharedComicPageMediaType(pages)).toBe('image/jpeg');
  });

  it('marks mixed archives and archives without pages as image/*', () => {
    const mixed = toComicPageEntries([
      { entryName: '001.png', sizeBytes: 1 },
      { entryName: '002.jpg', sizeBytes: 1 },
    ]);
    expect(sharedComicPageMediaType(mixed)).toBe('image/*');
    expect(sharedComicPageMediaType([])).toBe('image/*');
  });
});
