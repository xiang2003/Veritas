import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findUsedWords, pickPracticeWords } from '../src/lib/practice.ts';
import { buildTutorSystemPrompt, createTutorSession } from '../src/lib/tutor.ts';
import { createWordbook, type WordRecord } from '../src/lib/wordbook.ts';
import type { JsonGenerator, JsonRequest } from '../src/lib/gemini.ts';
import type { StorageLike } from '../src/lib/settings.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;
const rec = (key: string, o: Partial<WordRecord> = {}): WordRecord => ({
  key, term: key, lemma: key, pos: '', ipa: '', meaning: `${key}-zh`, definition: '', example: '',
  lookups: 1, firstSeen: 0, lastSeen: NOW - DAY, mastered: false, contexts: [{ url: 'other', title: '', sentence: '' }],
  ...o,
});

test('picks recent, still-learning words, those from this article first', () => {
  const words = pickPracticeWords(
    [
      rec('old', { lastSeen: NOW - 10 * DAY }),
      rec('known', { mastered: true }),
      rec('recent', { lastSeen: NOW - 1000 }),
      rec('here', { lastSeen: NOW - 3 * DAY, contexts: [{ url: 'https://cnn.com/a', title: '', sentence: '' }] }),
      rec('often', { lastSeen: NOW - DAY, lookups: 5 }),
    ],
    { now: NOW, articleUrl: 'https://cnn.com/a' },
  );
  assert.deepEqual(words.map((w) => w.word), ['here', 'recent', 'often']);
  assert.deepEqual(words[0], { key: 'here', word: 'here', meaning: 'here-zh' });
});

test('at most five words', () => {
  const many = Array.from({ length: 9 }, (_, i) => rec(`w${i}`));
  assert.equal(pickPracticeWords(many, { now: NOW, articleUrl: 'x' }).length, 5);
});

test('findUsedWords spots practice words in any inflection, but not inside other words', () => {
  const words = [
    { key: 'quell', word: 'quell', meaning: '' },
    { key: 'take off', word: 'take off', meaning: '' },
    { key: 'art', word: 'art', meaning: '' },
  ];
  const used = findUsedWords('The police quelled it and prices could take off, said the artist.', words);
  assert.deepEqual(used.map((w) => w.word), ['quell', 'take off']);
});

const article = { url: 'u', title: 'Storm', text: 'A storm.' };
const opts = { level: 'B2', nativeLanguage: 'X' };
const practice = [{ key: 'quell', word: 'quell', meaning: '平息' }];
const good = { reply: 'Nice!', corrections: [], betterAnswer: '', praise: '', hints: [] };

test('the tutor prompt lists the practice words and asks for them explicitly', () => {
  const p = buildTutorSystemPrompt(article, opts, practice);
  assert.match(p, /WORDS TO PRACTISE.*quell \(平息\)/);
  assert.match(p, /Try to use "quell"/);
  assert.doesNotMatch(buildTutorSystemPrompt(article, opts), /WORDS TO PRACTISE/);
});

test('the session reports practice words used in typed and spoken answers', async () => {
  const sent: JsonRequest[] = [];
  const client: JsonGenerator = {
    generateJson: async (r) => (sent.push(r), r.messages.some((m) => m.audio) ? { transcript: 'they quelled the protest' } : good),
  };
  const s = createTutorSession(client, article, opts, [], practice);
  assert.deepEqual((await s.send('I think they will quell it')).usedWords, ['quell']);
  assert.deepEqual((await s.send('no new words here')).usedWords, []);
  assert.deepEqual((await s.sendAudio({ mimeType: 'audio/webm', data: 'A' })).usedWords, ['quell']);
  assert.match(sent[0]!.system, /WORDS TO PRACTISE/);
});

function memory(): StorageLike {
  const data: Record<string, unknown> = {};
  return {
    get: async (keys) => structuredClone(Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]))),
    set: async (items) => void Object.assign(data, structuredClone(items)),
  };
}

test('markUsed counts uses of known words and ignores unknown keys', async () => {
  const book = createWordbook(memory());
  const entry = { term: 'quell', lemma: 'quell', pos: '', ipa: '', meaning: '平息', definition: '', example: '', usage: '' };
  await book.record(entry, { url: 'u', title: '', sentence: '' });
  await book.markUsed(['quell', 'nope']);
  await book.markUsed(['quell']);
  const [r] = await book.list();
  assert.equal(r!.uses, 2);
  assert.equal(r!.lookups, 1); // using a word is not looking it up
});
