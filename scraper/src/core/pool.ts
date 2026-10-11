/** Run `fn` over items with at most `n` in flight. Results keep input order; failures become null. */
export async function pool<T, R>(items: T[], n: number, fn: (item: T, index: number) => Promise<R>, onError?: (err: unknown, item: T) => void): Promise<Array<R | null>> {
  const out: Array<R | null> = new Array(items.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i]!, i);
      } catch (err) {
        onError?.(err, items[i]!);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}
