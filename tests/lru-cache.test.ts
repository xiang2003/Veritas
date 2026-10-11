import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLruCache } from '../src/lib/lru-cache.ts';
import type { StorageLike } from '../src/lib/settings.ts';

function memory(): StorageLike & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (keys) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]])),
    set: async (items) => void Object.assign(data, items),
  };
}

test('stores and returns values; missing keys give undefined', async () => {
  const cache = createLruCache<string>(memory(), { prefix: 'p:', indexKey: 'idx', max: 3 });
  await cache.set('a', 'A');
  assert.equal(await cache.get('a'), 'A');
  assert.equal(await cache.get('zzz'), undefined);
});

test('drops the oldest entries beyond max, and re-setting refreshes recency', async () => {
  const area = memory();
  const cache = createLruCache<string>(area, { prefix: 'p:', indexKey: 'idx', max: 2 });
  await cache.set('a', 'A');
  await cache.set('b', 'B');
  await cache.set('a', 'A2'); // a is now the newest
  await cache.set('c', 'C'); // evicts b
  assert.equal(await cache.get('b'), undefined);
  assert.equal(await cache.get('a'), 'A2');
  assert.equal(await cache.get('c'), 'C');
});
