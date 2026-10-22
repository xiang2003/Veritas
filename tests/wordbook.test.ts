import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWordbook, sentenceAround, sortRecords, toCsv, type WordRecord } from '../src/lib/wordbook.ts';
import type { StorageLike } from '../src/lib/settings.ts';
import type { VocabEntry } from '../src/lib/types.ts';

function memory(): StorageLike & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    // structuredClone mimics chrome.storage, which never hands out live references.
    get: async (keys) => structuredClone(Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]))),
    set: async (items) => void Object.assign(data, structuredClone(items)),
  };
}

const entry = (o: Partial<VocabEntry> = {}): VocabEntry => ({
  term: 'beleaguered', lemma: 'beleaguered', pos: 'adjective', ipa: '/bɪˈliːɡərd/', meaning: '處境艱難的',
  definition: 'in a very difficult situation', example: 'The beleaguered team kept going.', usage: '', ...o,
});
const ctx = (url = 'https://cnn.com/a', sentence = 'The beleaguered mayor resigned.') => ({ url, title: 'T', sentence });

function setup() {
  let clock = 1000;
  const area = memory();
  const book = createWordbook(area, () => clock);
  return { book, area, tick: (ms = 1) => (clock += ms) };
}

test('records a new word with its card and context', async () => {
  const { book } = setup();
  const r = await book.record(entry(), ctx());
  assert.equal(r.key, 'beleaguered');
  assert.equal(r.lookups, 1);
  assert.equal(r.meaning, '處境艱難的');
  assert.deepEqual(r.contexts, [ctx()]);
});

test('looking a word up again counts it, keeps the newest context first and fills missing fields', async () => {
  const { book, tick } = setup();
  await book.record(entry({ example: '' }), ctx('u1'));
  tick();
  await book.record(entry({ term: 'Beleaguered', meaning: '' }), ctx('u2'));
  tick();
  const r = await book.record(entry({ example: 'New example.' }), ctx('u1'));
  assert.equal(r.lookups, 3);
  assert.equal(r.meaning, '處境艱難的'); // not wiped by an empty value
  assert.equal(r.example, 'New example.');
  assert.deepEqual(r.contexts.map((c) => c.url), ['u1', 'u2']); // deduped by page, newest first
  assert.equal(r.firstSeen, 1000);
  assert.equal(r.lastSeen, 1002);
});

test('inflected forms share one record through the lemma', async () => {
  const { book } = setup();
  await book.record(entry({ term: 'took off', lemma: 'take off' }), ctx());
  await book.record(entry({ term: 'taking off', lemma: 'take off' }), ctx('u2'));
  const [r] = await book.list();
  assert.equal(r!.key, 'take off');
  assert.equal(r!.lookups, 2);
});

test('keeps at most five contexts', async () => {
  const { book } = setup();
  for (let i = 0; i < 7; i++) await book.record(entry(), ctx(`u${i}`));
  const [r] = await book.list();
  assert.equal(r!.contexts.length, 5);
  assert.equal(r!.contexts[0]!.url, 'u6');
});

test('mastered words sort last and become unknown again when looked up', async () => {
  const { book } = setup();
  await book.record(entry(), ctx());
  await book.record(entry({ term: 'quell', lemma: 'quell' }), ctx());
  await book.setMastered('beleaguered', true);
  assert.deepEqual((await book.list()).map((r) => [r.key, r.mastered]), [['quell', false], ['beleaguered', true]]);
  await book.record(entry(), ctx());
  assert.equal((await book.list()).find((r) => r.key === 'beleaguered')!.mastered, false);
});

test('remove deletes a word', async () => {
  const { book } = setup();
  await book.record(entry(), ctx());
  await book.remove('beleaguered');
  assert.deepEqual(await book.list(), []);
});

test('simultaneous lookups from several tabs are all counted', async () => {
  const { book } = setup();
  await Promise.all(Array.from({ length: 10 }, (_, i) => book.record(entry(), ctx(`u${i}`))));
  assert.equal((await book.list())[0]!.lookups, 10);
});

test('sortRecords: most looked-up first, then most recent', () => {
  const r = (key: string, lookups: number, lastSeen: number, mastered = false) => ({ key, lookups, lastSeen, mastered }) as WordRecord;
  const sorted = sortRecords([r('a', 1, 5), r('b', 3, 1), r('c', 1, 9), r('d', 9, 9, true)]);
  assert.deepEqual(sorted.map((x) => x.key), ['b', 'c', 'a', 'd']);
});

test('sentenceAround picks the sentence containing the term', () => {
  const text = 'First sentence here. The beleaguered mayor resigned on Monday! Then more followed.';
  assert.equal(sentenceAround(text, 'Beleaguered'), 'The beleaguered mayor resigned on Monday!');
  assert.equal(sentenceAround('No match here.', 'zzz'), 'No match here.');
});

test('toCsv quotes every cell and escapes quotes', async () => {
  const { book } = setup();
  await book.record(entry({ example: 'He said "no".' }), ctx());
  const csv = toCsv(await book.list());
  const [header, row] = csv.split('\r\n');
  assert.match(header!, /^term,lemma,pos,ipa,meaning/);
  assert.match(row!, /"He said ""no""\."/);
  assert.match(row!, /"1","The beleaguered mayor resigned\.","https:\/\/cnn\.com\/a"$/);
});

test('count: false updates the card without counting or un-mastering', async () => {
  const { book } = setup();
  await book.record(entry({ definition: '' }), ctx());
  await book.setMastered('beleaguered', true);
  const r = await book.record(entry({ definition: 'besieged' }), ctx(), { count: false });
  assert.equal(r.lookups, 1);
  assert.equal(r.definition, 'besieged');
  assert.equal(r.mastered, true);
});
