import { crc32 } from 'zlib';

export interface StoredRarEntry {
  name: string;
  data: Buffer;
  /** Overrides the unpacked size stored in the header. */
  declaredSize?: number;
  /** Sets the encrypted flag without encrypting the payload. */
  encrypted?: boolean;
}

const RAR4_MARKER = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]);
const HEAD_TYPE_MAIN = 0x73;
const HEAD_TYPE_FILE = 0x74;
const HEAD_TYPE_END = 0x7b;
const FLAG_LONG_BLOCK = 0x8000;
const FLAG_FILE_ENCRYPTED = 0x0004;
const FLAG_SKIP_IF_UNKNOWN = 0x4000;
const HOST_OS_UNIX = 3;
const UNPACK_VERSION = 20;
const METHOD_STORED = 0x30;
const UNIX_REGULAR_FILE_MODE = 0o100644;
const MAIN_HEADER_RESERVED_BYTES = 6;

// RAR stores the low 16 bits of the header CRC32.
function headerBlock(type: number, flags: number, body: Buffer): Buffer {
  const block = Buffer.alloc(7 + body.length);
  block.writeUInt8(type, 2);
  block.writeUInt16LE(flags, 3);
  block.writeUInt16LE(block.length, 5);
  body.copy(block, 7);
  block.writeUInt16LE(crc32(block.subarray(2)) & 0xffff, 0);
  return block;
}

function dosDateTime(date: Date): number {
  return (
    (((date.getFullYear() - 1980) << 25) |
      ((date.getMonth() + 1) << 21) |
      (date.getDate() << 16) |
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      (date.getSeconds() >> 1)) >>>
    0
  );
}

function fileBlock(entry: StoredRarEntry, modifiedAt: Date): Buffer {
  const name = Buffer.from(entry.name, 'utf8');
  const body = Buffer.alloc(25 + name.length);
  let offset = 0;
  body.writeUInt32LE(entry.data.length, offset);
  offset += 4;
  body.writeUInt32LE(entry.declaredSize ?? entry.data.length, offset);
  offset += 4;
  body.writeUInt8(HOST_OS_UNIX, offset);
  offset += 1;
  body.writeUInt32LE(crc32(entry.data) >>> 0, offset);
  offset += 4;
  body.writeUInt32LE(dosDateTime(modifiedAt), offset);
  offset += 4;
  body.writeUInt8(UNPACK_VERSION, offset);
  offset += 1;
  body.writeUInt8(METHOD_STORED, offset);
  offset += 1;
  body.writeUInt16LE(name.length, offset);
  offset += 2;
  body.writeUInt32LE(UNIX_REGULAR_FILE_MODE, offset);
  offset += 4;
  name.copy(body, offset);

  const flags = FLAG_LONG_BLOCK | (entry.encrypted ? FLAG_FILE_ENCRYPTED : 0);
  return Buffer.concat([headerBlock(HEAD_TYPE_FILE, flags, body), entry.data]);
}

// Build a minimal RAR 4 archive with stored entries; Node has no RAR writer.
export function buildStoredRarArchive(entries: readonly StoredRarEntry[], modifiedAt = new Date(2026, 0, 1, 12, 0, 0)): Buffer {
  return Buffer.concat([
    RAR4_MARKER,
    headerBlock(HEAD_TYPE_MAIN, 0, Buffer.alloc(MAIN_HEADER_RESERVED_BYTES)),
    ...entries.map((entry) => fileBlock(entry, modifiedAt)),
    headerBlock(HEAD_TYPE_END, FLAG_SKIP_IF_UNKNOWN, Buffer.alloc(0)),
  ]);
}
