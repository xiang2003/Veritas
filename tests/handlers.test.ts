import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandlers } from '../src/background/handlers.ts';
import { DEFAULT_SETTINGS, type Settings, type StorageLike } from '../src/lib/settings.ts';
import type { JsonGenerator } from '../src/lib/gemini.ts';

const article = { url: 'https://cnn.com/a', title: 'T', text: 'An eloquent speech.' };
const raw = { entries: [{ term: 'eloquent', meaning: '雄辯的' }] };

function memory(): StorageLike & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (keys) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]])),
    set: async (items) => void Object.assign(data, items),
  };
}

function setup(overrides: Partial<Settings> = {}, generate: JsonGenerator['generateJson'] = async () => raw) {
  let calls = 0;
  const client: JsonGenerator = { generateJson: async (r) => (calls++, generate(r)) };
  const cache = memory();
  const session = memory();
  const settings = { ...DEFAULT_SETTINGS, apiKey: 'k', ...overrides };
  const handlers = createHandlers({ client, getSettings: async () => settings, cache, session });
  return { handlers, cache, session, calls: () => calls };
}

test('ignores unknown messages', () => {
  assert.equal(setup().handlers.handle({ type: 'nope' } as never), undefined);
});

test('analyzes, registers article for the tab and caches the result', async () => {
  const s = setup();
  const res = await s.handlers.handle({ type: 'analyze', article }, 7);
  assert.ok(res && 'entries' in res && res.entries[0]!.term === 'eloquent');
  assert.deepEqual(s.session.data['article:7'], article);
  assert.ok(s.cache.data[`vocab:${article.url}`]);
});

test('second request for same article and settings hits the cache', async () => {
  const s = setup();
  await s.handlers.handle({ type: 'analyze', article }, 1);
  await s.handlers.handle({ type: 'analyze', article }, 1);
  assert.equal(s.calls(), 1);
});

test('changing level invalidates the cache', async () => {
  const s = setup();
  await s.handlers.handle({ type: 'analyze', article }, 1);
  const h2 = createHandlers({
    client: { generateJson: async () => raw }, cache: s.cache, session: s.session,
    getSettings: async () => ({ ...DEFAULT_SETTINGS, apiKey: 'k', level: 'C2' }),
  });
  await h2.handle({ type: 'analyze', article }, 1);
  assert.equal((s.cache.data[`vocab:${article.url}`] as { signature: string }).signature, 'C2|Traditional Chinese');
});

test('autoHighlight off still registers the article but skips the AI call', async () => {
  const s = setup({ autoHighlight: false });
  const res = await s.handlers.handle({ type: 'analyze', article }, 3);
  assert.deepEqual(res, { ok: true, entries: [] });
  assert.equal(s.calls(), 0);
  assert.ok(s.session.data['article:3']);
});

test('AI failures become an error response, not an exception', async () => {
  const s = setup({}, async () => {
    throw new Error('quota');
  });
  assert.deepEqual(await s.handlers.handle({ type: 'analyze', article }, 1), { ok: false, error: 'quota' });
});

test('evicts the oldest cached article beyond the limit', async () => {
  const s = setup();
  for (let i = 0; i < 101; i++) {
    await s.handlers.handle({ type: 'analyze', article: { ...article, url: `https://x/${i}` } }, 1);
  }
  assert.equal(s.cache.data['vocab:https://x/0'], null);
  assert.ok(s.cache.data['vocab:https://x/100']);
});

test('empty AI results are not cached, so the next visit retries', async () => {
  const s = setup({}, async () => ({ entries: [] }));
  await s.handlers.handle({ type: 'analyze', article }, 1);
  await s.handlers.handle({ type: 'analyze', article }, 1);
  assert.equal(s.calls(), 2);
});

test('translations are cached per paragraph and language', async () => {
  let calls = 0;
  const s = setup({}, async () => (calls++, { translation: '你好' }));
  const ask = (text: string) => s.handlers.handle({ type: 'translate', text, title: 'T' });
  assert.deepEqual(await ask('Hello there'), { ok: true, translation: '你好' });
  await ask('Hello there');
  assert.equal(calls, 1);
  await ask('Another paragraph');
  assert.equal(calls, 2);
});

test('failed translations are not cached', async () => {
  let fail = true;
  const s = setup({}, async () => {
    if (fail) throw new Error('quota');
    return { translation: 'ok' };
  });
  const ask = () => s.handlers.handle({ type: 'translate', text: 'Hello there', title: 'T' });
  assert.deepEqual(await ask(), { ok: false, error: 'quota' });
  fail = false;
  assert.deepEqual(await ask(), { ok: true, translation: 'ok' });
});

const headlines = [
  { url: 'https://cnn.com/2026/a', title: 'Storm hits the coast' },
  { url: 'https://cnn.com/2026/b', title: 'Markets fall sharply' },
];

function recommendSetup() {
  let calls = 0;
  let clock = 0;
  const cache = memory();
  const settings = { ...DEFAULT_SETTINGS, apiKey: 'k', interests: 'science' };
  const handlers = createHandlers({
    client: { generateJson: async () => (calls++, { picks: [{ id: 2, reason: 'r', level: 'B2', topic: 'Economy' }] }) },
    getSettings: async () => settings,
    cache,
    session: memory(),
    now: () => clock,
  });
  const ask = (force = false) => handlers.handle({ type: 'recommend', pageUrl: 'https://cnn.com/', headlines, force });
  return { ask, calls: () => calls, advance: (ms: number) => (clock += ms), settings };
}

test('recommendations are returned and cached for the page', async () => {
  const s = recommendSetup();
  const res = await s.ask();
  assert.ok(res && 'picks' in res && res.picks[0]!.title === 'Markets fall sharply');
  await s.ask();
  assert.equal(s.calls(), 1);
});

test('cached recommendations expire after 30 minutes, on refresh, or when interests change', async () => {
  const s = recommendSetup();
  await s.ask();
  s.advance(31 * 60_000);
  await s.ask();
  assert.equal(s.calls(), 2);
  await s.ask(true);
  assert.equal(s.calls(), 3);
  s.settings.interests = 'sports';
  await s.ask();
  assert.equal(s.calls(), 4);
});
