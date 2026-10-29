import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createMistakebook, mistakeKey, sortMistakes, type MistakeRecord } from '../src/lib/mistakes.ts';
import { filterMistakes, renderMistake, renderMistakeList } from '../src/wordbook/mistakes-view.ts';
import { createHandlers } from '../src/background/handlers.ts';
import { DEFAULT_SETTINGS, type StorageLike } from '../src/lib/settings.ts';

function memory(): StorageLike & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (keys) => structuredClone(Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]))),
    set: async (items) => void Object.assign(data, structuredClone(items)),
  };
}

const tense = { original: 'I go there yesterday', corrected: 'I went there yesterday', explanation: '過去式' };
const article = { utterance: 'I go there yesterday and it was fun', url: 'https://cnn.com/a', title: 'Storm' };

function setup() {
  let clock = 1000;
  const book = createMistakebook(memory(), () => clock);
  return { book, tick: () => clock++ };
}

test('mistakeKey ignores case, punctuation and apostrophe style', () => {
  assert.equal(
    mistakeKey({ original: 'I dont know.', corrected: 'I don’t know' }),
    mistakeKey({ original: 'i dont know', corrected: "I don't know!" }),
  );
});

test('records each correction with where it happened', async () => {
  const { book } = setup();
  const [r] = await book.record([tense], article);
  assert.equal(r!.count, 1);
  assert.equal(r!.explanation, '過去式');
  assert.deepEqual(r!.examples.map((e) => e.utterance), [article.utterance]);
});

test('the same mistake again is counted, keeps 3 newest examples, and un-masters it', async () => {
  const { book, tick } = setup();
  for (let i = 0; i < 4; i++) {
    tick();
    await book.record([{ ...tense, explanation: i === 3 ? '' : tense.explanation }], { ...article, utterance: `answer ${i}` });
    if (i === 1) await book.setMastered(mistakeKey(tense), true);
  }
  const [r] = await book.list();
  assert.equal(r!.count, 4);
  assert.equal(r!.mastered, false);
  assert.equal(r!.explanation, '過去式'); // an empty explanation does not erase the old one
  assert.deepEqual(r!.examples.map((e) => e.utterance), ['answer 3', 'answer 2', 'answer 1']);
});

test('list: still-practising first, most repeated first; remove deletes', async () => {
  const { book } = setup();
  const other = { original: 'more better', corrected: 'better', explanation: '' };
  await book.record([tense, other], article);
  await book.record([other], article);
  await book.setMastered(mistakeKey(other), true);
  assert.deepEqual((await book.list()).map((r) => r.original), ['I go there yesterday', 'more better']);
  await book.remove(mistakeKey(tense));
  assert.equal((await book.list()).length, 1);
});

test('sortMistakes orders by mastered, count, recency', () => {
  const r = (key: string, count: number, lastSeen: number, mastered = false) => ({ key, count, lastSeen, mastered }) as MistakeRecord;
  const sorted = sortMistakes([r('a', 1, 9), r('b', 3, 1), r('c', 1, 10), r('d', 9, 9, true)]);
  assert.deepEqual(sorted.map((x) => x.key), ['b', 'c', 'a', 'd']);
});

test('background records corrections sent by the side panel', async () => {
  const cache = memory();
  const handlers = createHandlers({
    client: { generateJson: async () => ({}) },
    getSettings: async () => ({ ...DEFAULT_SETTINGS, apiKey: 'k' }),
    cache,
    session: memory(),
  });
  assert.deepEqual(await handlers.handle({ type: 'record-mistakes', corrections: [tense], source: article }), { ok: true });
  assert.equal(Object.keys(cache.data['mistakes'] as object).length, 1);
});

const record = (o: Partial<MistakeRecord> = {}): MistakeRecord => ({
  key: 'k',
  original: 'I go there yesterday',
  corrected: 'I went there yesterday',
  explanation: '過去式要用 went',
  count: 2,
  firstSeen: 0,
  lastSeen: 0,
  mastered: false,
  examples: [{ ...article, at: 0 }],
  ...o,
});
const doc = () => new JSDOM('<body></body>').window.document as unknown as Document;
const noop = { speak() {}, setMastered() {}, remove() {} };

test('filterMistakes splits by tab and searches wrong text, correction and explanation', () => {
  const all = [record(), record({ key: 'm', original: 'more better', corrected: 'better', explanation: '', mastered: true })];
  assert.deepEqual(filterMistakes(all, { query: '', tab: 'learning' }).map((r) => r.key), ['k']);
  assert.deepEqual(filterMistakes(all, { query: 'MORE', tab: 'all' }).map((r) => r.key), ['m']);
  assert.deepEqual(filterMistakes(all, { query: 'went', tab: 'all' }).map((r) => r.key), ['k']);
});

test('a mistake card shows wrong and right, the count and the learner sentence, as text only', () => {
  const card = renderMistake(doc(), record({ explanation: '<img src=x onerror=alert(1)>' }), noop);
  assert.equal(card.querySelector('del')!.textContent, 'I go there yesterday');
  assert.equal(card.querySelector('ins')!.textContent, 'I went there yesterday');
  assert.match(card.textContent!, /錯了 2 次/);
  assert.match(card.textContent!, /I go there yesterday and it was fun/);
  assert.equal(card.querySelector('img'), null);
});

test('mistake card buttons call the actions; an empty book explains itself', () => {
  const calls: string[] = [];
  const card = renderMistake(doc(), record(), {
    speak: (r) => void calls.push(`speak:${r.corrected}`),
    setMastered: (_r, m) => void calls.push(`mastered:${m}`),
    remove: () => void calls.push('remove'),
  });
  card.querySelectorAll('button').forEach((b) => b.click());
  assert.deepEqual(calls, ['speak:I went there yesterday', 'mastered:true', 'remove']);
  assert.match(renderMistakeList(doc(), [], noop)[0]!.textContent!, /被糾正的地方會記在這裡/);
});
