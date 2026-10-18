/**
 * Runs `worker` over `items` with at most `limit` in flight at once and
 * returns results in input order. Used where per-resort work is
 * independent and latency-bound (one HTTP lookup + one DB write each), so
 * a handful in parallel finishes several times faster without hammering
 * any one API.
 */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]!, i);
    }
  });
  await Promise.all(runners);
  return results;
}
