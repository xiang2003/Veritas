import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSettings, DEFAULT_SETTINGS } from '../src/lib/settings.js';

function fakeArea(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get: async (keys) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]])),
    set: async (patch) => Object.assign(data, patch),
  };
}

test('get merges stored values over defaults', async () => {
  const s = createSettings(fakeArea({ apiKey: 'abc' }));
  assert.deepEqual(await s.get(), { ...DEFAULT_SETTINGS, apiKey: 'abc' });
});

test('set ignores unknown keys', async () => {
  const area = fakeArea();
  await createSettings(area).set({ level: 'C1', evil: 1 });
  assert.deepEqual(area.data, { level: 'C1' });
});
