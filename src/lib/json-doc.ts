import type { StorageLike } from './settings.ts';

/**
 * One JSON document stored under a single storage key. Every change is a read-modify-write, so
 * changes are queued: several changes in flight (e.g. lookups from many tabs) cannot overwrite
 * each other. Keep all writers of a key in one context (the service worker) for the same reason.
 */
export function createJsonDoc<T>(area: StorageLike, key: string, empty: () => T) {
  let queue: Promise<unknown> = Promise.resolve();
  const read = async (): Promise<T> => ((await area.get([key]))[key] as T | undefined) ?? empty();

  return {
    /** Current content, after any queued changes. */
    async read(): Promise<T> {
      await queue;
      return read();
    },
    change<R>(mutate: (doc: T) => R): Promise<R> {
      const run = queue.then(async () => {
        const doc = await read();
        const result = mutate(doc);
        await area.set({ [key]: doc });
        return result;
      });
      queue = run.catch(() => {});
      return run;
    },
  };
}
