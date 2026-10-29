import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConversationStore, MAX_CONVERSATIONS } from '../src/lib/conversations.ts';
import type { StorageLike } from '../src/lib/settings.ts';

function memory(): StorageLike & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (keys) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]])),
    set: async (items) => void Object.assign(data, items),
  };
}

test('saved conversations are loaded back; unknown articles give null', async () => {
  const store = createConversationStore<{ n: number }>(memory());
  await store.save('https://cnn.com/a', { n: 1 });
  assert.deepEqual(await store.load('https://cnn.com/a'), { n: 1 });
  assert.equal(await store.load('https://cnn.com/b'), null);
});

test('a new store over the same storage still has them (survives restarts)', async () => {
  const area = memory();
  await createConversationStore<{ n: number }>(area).save('u', { n: 2 });
  assert.deepEqual(await createConversationStore<{ n: number }>(area).load('u'), { n: 2 });
});

test('only the most recent conversations are kept', async () => {
  const store = createConversationStore<number>(memory());
  for (let i = 0; i <= MAX_CONVERSATIONS; i++) await store.save(`u${i}`, i);
  assert.equal(await store.load('u0'), null);
  assert.equal(await store.load(`u${MAX_CONVERSATIONS}`), MAX_CONVERSATIONS);
});
