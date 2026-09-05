import { parseSevenZipListing } from './cb7-pages';

const LISTING = [
  'Path = pages',
  'Size = 0',
  'Packed Size = 0',
  'Modified = 2026-09-05 10:54:56.3850000',
  'Attributes = D drwxr-xr-x',
  'CRC = ',
  'Encrypted = -',
  'Method = ',
  'Block = ',
  '',
  'Path = pages/pa[ge] 1.png',
  'Size = 1',
  'Packed Size = 7',
  'Modified = 2026-09-05 10:54:56.3850000',
  'Attributes = A -rw-r--r--',
  'CRC = D3D99E8B',
  'Encrypted = -',
  'Method = LZMA2:12',
  'Block = 0',
  '',
  'Path = pages/page 2.jpg',
  'Size = 2048',
  'Packed Size = ',
  'Modified = 2026-09-05 10:54:56.3850000',
  'Attributes = A -rw-r--r--',
  'CRC = 1B441FC4',
  'Encrypted = +',
  'Method = 7zAES:19 LZMA2:12',
  'Block = 0',
  '',
];

describe('parseSevenZipListing', () => {
  it('turns -slt blocks into entries with size, kind and encryption', () => {
    expect(parseSevenZipListing(LISTING)).toEqual([
      { path: 'pages', sizeBytes: 0, directory: true, encrypted: false },
      { path: 'pages/pa[ge] 1.png', sizeBytes: 1, directory: false, encrypted: false },
      { path: 'pages/page 2.jpg', sizeBytes: 2048, directory: false, encrypted: true },
    ]);
  });

  it('keeps a value that itself contains the separator', () => {
    expect(parseSevenZipListing(['Path = odd = name.jpg', 'Size = 3', 'Attributes = A'])).toEqual([
      { path: 'odd = name.jpg', sizeBytes: 3, directory: false, encrypted: false },
    ]);
  });

  it('returns nothing for empty output', () => {
    expect(parseSevenZipListing([])).toEqual([]);
    expect(parseSevenZipListing(['', ''])).toEqual([]);
  });
});
