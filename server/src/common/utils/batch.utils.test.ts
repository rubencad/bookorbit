import { forEachWithConcurrency } from './batch.utils';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('forEachWithConcurrency', () => {
  it('runs every item with bounded concurrency', async () => {
    let inFlight = 0;
    let peak = 0;
    const seen: number[] = [];

    await forEachWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await wait(5);
      seen.push(item);
      inFlight -= 1;
    });

    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
  });

  it('drains running work before rethrowing the first failure and starts nothing after it', async () => {
    const started: number[] = [];
    const finished: number[] = [];

    await expect(
      forEachWithConcurrency([0, 1, 2, 3], 2, async (item) => {
        started.push(item);
        if (item === 1) throw new Error(`item ${item} failed`);
        await wait(20);
        finished.push(item);
      }),
    ).rejects.toThrow('item 1 failed');

    expect(started).toEqual([0, 1]);
    expect(finished).toEqual([0]);
  });

  it('resolves immediately for an empty list', async () => {
    const worker = vi.fn();
    await forEachWithConcurrency([], 3, worker);
    expect(worker).not.toHaveBeenCalled();
  });
});
