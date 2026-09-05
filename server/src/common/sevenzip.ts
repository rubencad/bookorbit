// Shared 7z-wasm singleton - one WASM instance for the server lifetime.
// The comic reader, metadata extraction and release archives all use this.

import { randomUUID } from 'crypto';

export interface SevenZipFS {
  open(path: string, flags: string): number;
  write(fd: number, buf: Uint8Array, offset: number, length: number): number;
  close(fd: number): void;
  mkdir(path: string): void;
  readdir(path: string): string[];
  readFile(path: string): Uint8Array;
  /** An entry's size and kind without reading it, which is what bounds an extraction. */
  stat(path: string): { mode: number; size: number };
  isDir(mode: number): boolean;
  unlink(path: string): void;
  rmdir(path: string): void;
  mount(type: unknown, options: { root: string }, mountPoint: string): void;
  unmount(mountPoint: string): void;
}

export interface SevenZipModule {
  FS: SevenZipFS;
  NODEFS: unknown;
  callMain(args: string[]): void;
}

export interface SevenZipRunResult {
  stdout: string[];
  stderr: string[];
  exitError: unknown;
}

let _instance: SevenZipModule | null = null;
let _instancePromise: Promise<SevenZipModule> | null = null;
let _capture: SevenZipRunResult | null = null;

function printLine(line: string): void {
  if (_capture) _capture.stdout.push(line);
  else console.log(line);
}

function printErrorLine(line: string): void {
  if (_capture) _capture.stderr.push(line);
  else console.error(line);
}

export async function getSevenZip(): Promise<SevenZipModule> {
  if (_instance) return _instance;

  if (!_instancePromise) {
    _instancePromise = import('7z-wasm')
      .then((mod) => {
        const factory = (mod.default ?? mod) as unknown as (opts?: object) => Promise<SevenZipModule>;
        return factory({ print: printLine, printErr: printErrorLine });
      })
      .then((module) => {
        _instance = module;
        return module;
      })
      .catch((error) => {
        _instancePromise = null;
        throw error;
      });
  }
  return _instancePromise;
}

// runSevenZip is synchronous, so calls cannot overlap on the shared capture buffer
export function runSevenZip(sevenZip: SevenZipModule, args: string[]): SevenZipRunResult {
  const result: SevenZipRunResult = { stdout: [], stderr: [], exitError: null };
  _capture = result;
  try {
    sevenZip.callMain(args);
  } catch (error) {
    result.exitError = error;
  } finally {
    _capture = null;
  }
  return result;
}

/**
 * A name for one caller's scratch directory in the shared WASM filesystem.
 *
 * There is one instance for the whole server, so two extractions running at once share a
 * filesystem: anything derived from the clock collides, and a collision means one of them removes
 * the other's tree while it is still being read.
 */
export function createSevenZipTempId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}
