import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { filterRecords, renderList, renderRecord } from '../src/wordbook/view.ts';
import type { WordRecord } from '../src/lib/wordbook.ts';

const rec = (o: Partial<WordRecord> = {}): WordRecord => ({
  key: 'quell', term: 'quelled', lemma: 'quell', pos: 'verb', ipa: '/kwɛl/', meaning: '平息', definition: 'to stop',
  example: 'Police quelled the riot.', lookups: 3, firstSeen: 0, lastSeen: 0, mastered: false,
  contexts: [{ url: 'https://cnn.com/a', title: 'Riots end', sentence: 'Troops quelled the unrest.' }],
  ...o,
});
const doc = () => new JSDOM('<body></body>').window.document as unknown as Document;
const noop = { speak() {}, setMastered() {}, remove() {} };

test('filterRecords splits by tab and searches term, lemma and meaning', () => {
  const all = [rec(), rec({ key: 'b', lemma: 'beleaguer', term: 'beleaguered', meaning: '圍困', mastered: true })];
  assert.deepEqual(filterRecords(all, { query: '', tab: 'learning' }).map((r) => r.key), ['quell']);
  assert.deepEqual(filterRecords(all, { query: '', tab: 'mastered' }).map((r) => r.key), ['b']);
  assert.equal(filterRecords(all, { query: '', tab: 'all' }).length, 2);
  assert.deepEqual(filterRecords(all, { query: '圍', tab: 'all' }).map((r) => r.key), ['b']);
  assert.deepEqual(filterRecords(all, { query: 'QUELLED', tab: 'all' }).map((r) => r.key), ['quell']);
});

test('a card shows the lookup count, meaning and where the word was met, as text only', () => {
  const card = renderRecord(doc(), rec({ meaning: '<img src=x onerror=alert(1)>' }), noop);
  assert.match(card.textContent!, /查了 3 次/);
  assert.match(card.textContent!, /Troops quelled the unrest\./);
  assert.equal(card.querySelector('img'), null);
  assert.equal(card.querySelector<HTMLAnchorElement>('.context a')!.href, 'https://cnn.com/a');
});

test('card buttons call the actions; mastered words offer to relearn', () => {
  const calls: string[] = [];
  const actions = {
    speak: (r: WordRecord) => void calls.push(`speak:${r.key}`),
    setMastered: (r: WordRecord, m: boolean) => void calls.push(`mastered:${r.key}:${m}`),
    remove: (r: WordRecord) => void calls.push(`remove:${r.key}`),
  };
  const buttons = (r: WordRecord) => [...renderRecord(doc(), r, actions).querySelectorAll('button')];
  buttons(rec()).forEach((b) => b.click());
  const [, relearn] = buttons(rec({ mastered: true }));
  assert.equal(relearn!.textContent, '↺ 重新學習');
  relearn!.click();
  assert.deepEqual(calls, ['speak:quell', 'mastered:quell:true', 'remove:quell', 'mastered:quell:false']);
});

test('an empty wordbook explains how words get added', () => {
  const [p] = renderList(doc(), [], noop);
  assert.match(p!.textContent!, /反白後按「解釋」/);
});
