export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) throw new Error('chunk size must be greater than zero');
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * Worker-pool map that keeps at most `limit` operations in flight and returns
 * results in input order. Preferred over chunked Promise.all when per-item cost
 * varies, because a slow item does not stall the whole chunk.
 */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;

  let nextIndex = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (let index = nextIndex++; index < items.length; index = nextIndex++) {
      results[index] = await worker(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Runs `worker` over `items` with at most `limit` in flight and settles only once every started
 * item has finished. Nothing new starts after the first rejection, which is rethrown afterwards, so
 * a caller that retries never overlaps work that was still running.
 */
export async function forEachWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;

  let nextIndex = 0;
  const state: { failure: { error: unknown } | null } = { failure: null };
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (state.failure === null && nextIndex < items.length) {
      const index = nextIndex++;
      try {
        await worker(items[index]!, index);
      } catch (error) {
        state.failure ??= { error };
      }
    }
  });
  await Promise.all(workers);
  if (state.failure) throw state.failure.error;
}
