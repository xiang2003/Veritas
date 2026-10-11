import type { StorageLike } from './settings.ts';

export interface LruOptions {
  /** Storage key prefix for entries, e.g. "vocab:". */
  prefix: string;
  /** Storage key holding the ordered list of keys (oldest first). */
  indexKey: string;
  max: number;
}

/** Bounded persistent cache on top of a storage area: the oldest entries are dropped beyond `max`. */
export function createLruCache<T>(area: StorageLike, { prefix, indexKey, max }: LruOptions) {
  return {
    async get(key: string): Promise<T | undefined> {
      const full = prefix + key;
      return ((await area.get([full]))[full] as T | null | undefined) ?? undefined;
    },
    async set(key: string, value: T): Promise<void> {
      const index = (((await area.get([indexKey]))[indexKey] as string[] | undefined) ?? []).filter((k) => k !== key);
      index.push(key);
      const evicted = index.splice(0, Math.max(0, index.length - max));
      await area.set({ [prefix + key]: value, [indexKey]: index });
      // StorageLike has no remove(); overwrite evicted entries with an empty marker.
      await Promise.all(evicted.map((k) => area.set({ [prefix + k]: null })));
    },
  };
}
