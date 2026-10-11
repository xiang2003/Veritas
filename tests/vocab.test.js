import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEntries, analyzeVocabulary, buildVocabSystemPrompt } from '../src/lib/vocab.js';

const ARTICLE = 'The mayor gave an eloquent speech. Critics said it was a red herring.';
const row = (o) => ({ term: 'eloquent', meaning: '雄辯的', ...o });

test('keeps valid entries and fills defaults', () => {
  const [e] = normalizeEntries({ entries: [row({ ipa: ' /x/ ' })] }, ARTICLE);
  assert.equal(e.lemma, 'eloquent');
  assert.equal(e.ipa, '/x/');
  assert.equal(e.example, '');
});

test('drops hallucinated terms, duplicates and rows without meaning', () => {
  const out = normalizeEntries(
    { entries: [row({ term: 'ubiquitous' }), row(), row({ term: 'ELOQUENT' }), row({ term: 'red herring', meaning: '' }), null] },
    ARTICLE,
  );
  assert.deepEqual(out.map((e) => e.term), ['eloquent']);
});

test('tolerates malformed payloads', () => {
  assert.deepEqual(normalizeEntries(null, ARTICLE), []);
  assert.deepEqual(normalizeEntries({ entries: 'x' }, ARTICLE), []);
});

test('prompt carries level and native language', () => {
  const p = buildVocabSystemPrompt({ level: 'C1', nativeLanguage: 'Japanese' });
  assert.match(p, /C1/);
  assert.match(p, /Japanese/);
});

test('analyzeVocabulary sends article to client and normalizes result', async () => {
  let sent;
  const client = { generateJson: async (r) => ((sent = r), { entries: [row()] }) };
  const out = await analyzeVocabulary(client, { title: 'T', text: ARTICLE }, { level: 'B2', nativeLanguage: 'X' });
  assert.equal(out.length, 1);
  assert.match(sent.messages[0].text, /Title: T/);
});
