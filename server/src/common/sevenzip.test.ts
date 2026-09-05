describe('getSevenZip', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('initializes once and reuses the cached module for subsequent calls', async () => {
    const instance = {
      FS: {
        open: vi.fn(),
        write: vi.fn(),
        close: vi.fn(),
        mkdir: vi.fn(),
        readdir: vi.fn(),
        readFile: vi.fn(),
        unlink: vi.fn(),
        rmdir: vi.fn(),
      },
      callMain: vi.fn(),
    };
    const factory = vi.fn().mockResolvedValue(instance);

    vi.doMock('7z-wasm', () => ({ default: factory }));

    const { getSevenZip } = await import('./sevenzip');

    const first = await getSevenZip();
    const second = await getSevenZip();

    expect(first).toBe(instance);
    expect(second).toBe(instance);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('shares a single in-flight initialization across concurrent callers', async () => {
    const instance = {
      FS: {
        open: vi.fn(),
        write: vi.fn(),
        close: vi.fn(),
        mkdir: vi.fn(),
        readdir: vi.fn(),
        readFile: vi.fn(),
        unlink: vi.fn(),
        rmdir: vi.fn(),
      },
      callMain: vi.fn(),
    };

    let resolveFactory!: (value: typeof instance) => void;
    const pending = new Promise<typeof instance>((resolve) => {
      resolveFactory = resolve;
    });
    const factory = vi.fn().mockReturnValue(pending);

    vi.doMock('7z-wasm', () => ({ default: factory }));

    const { getSevenZip } = await import('./sevenzip');

    const first = getSevenZip();
    const second = getSevenZip();

    resolveFactory(instance);

    await expect(Promise.all([first, second])).resolves.toEqual([instance, instance]);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('clears failed initialization state so the next call can retry', async () => {
    const instance = {
      FS: {
        open: vi.fn(),
        write: vi.fn(),
        close: vi.fn(),
        mkdir: vi.fn(),
        readdir: vi.fn(),
        readFile: vi.fn(),
        unlink: vi.fn(),
        rmdir: vi.fn(),
      },
      callMain: vi.fn(),
    };

    const factory = vi.fn().mockRejectedValueOnce(new Error('7z init failed')).mockResolvedValueOnce(instance);

    vi.doMock('7z-wasm', () => ({ default: factory }));

    const { getSevenZip } = await import('./sevenzip');

    await expect(getSevenZip()).rejects.toThrow('7z init failed');
    await expect(getSevenZip()).resolves.toBe(instance);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('captures stdout, stderr, and the thrown exit status', async () => {
    let hooks!: { print: (line: string) => void; printErr: (line: string) => void };
    const instance = {
      FS: {},
      callMain: vi.fn((args: string[]) => {
        hooks.print(`Path = ${args[0]}`);
        hooks.printErr('ERROR: nope');
        // The WASM runtime throws its numeric exit status, not an Error.
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        if (args[0] === 'boom') throw 2;
      }),
    };
    const factory = vi.fn((options: typeof hooks) => {
      hooks = options;
      return Promise.resolve(instance);
    });

    vi.doMock('7z-wasm', () => ({ default: factory }));

    const { getSevenZip, runSevenZip } = await import('./sevenzip');
    const sevenZip = await getSevenZip();

    expect(runSevenZip(sevenZip, ['a.cb7'])).toEqual({ stdout: ['Path = a.cb7'], stderr: ['ERROR: nope'], exitError: null });
    expect(runSevenZip(sevenZip, ['boom'])).toEqual({ stdout: ['Path = boom'], stderr: ['ERROR: nope'], exitError: 2 });
  });

  it('forwards output to the console when no command is being captured', async () => {
    let hooks!: { print: (line: string) => void; printErr: (line: string) => void };
    const factory = vi.fn((options: typeof hooks) => {
      hooks = options;
      return Promise.resolve({ FS: {}, callMain: vi.fn() });
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    vi.doMock('7z-wasm', () => ({ default: factory }));

    const { getSevenZip } = await import('./sevenzip');
    await getSevenZip();
    hooks.print('banner');
    hooks.printErr('warning');

    expect(log).toHaveBeenCalledWith('banner');
    expect(error).toHaveBeenCalledWith('warning');
    log.mockRestore();
    error.mockRestore();
  });
});
