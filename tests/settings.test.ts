import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSettings, DEFAULT_SETTINGS, type StorageLike } from '../src/lib/settings.ts';

function fakeArea(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  const area: StorageLike & { data: Record<string, unknown> } = {
    data,
    get: async (keys) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]])),
    set: async (patch) => void Object.assign(data, patch),
  };
  return area;
}

test('get merges stored values over defaults', async () => {
  const s = createSettings(fakeArea({ apiKey: 'abc' }));
  assert.deepEqual(await s.get(), { ...DEFAULT_SETTINGS, apiKey: 'abc' });
});

test('set ignores unknown keys', async () => {
  const area = fakeArea();
  await createSettings(area).set({ level: 'C1', evil: 1 } as never);
  assert.deepEqual(area.data, { level: 'C1' });
});
