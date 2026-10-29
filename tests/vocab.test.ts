import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeVocabulary, buildVocabSystemPrompt, defineTerm, findSurfaceForm, normalizeEntries, termKey } from '../src/lib/vocab.ts';
import type { JsonGenerator, JsonRequest } from '../src/lib/gemini.ts';

const ARTICLE = 'The mayor gave an eloquent speech. Critics said it was a red herring.';
const row = (o: object = {}) => ({ term: 'eloquent', meaning: '雄辯的', ...o });

test('keeps valid entries and fills defaults', () => {
  const [e] = normalizeEntries({ entries: [row({ ipa: ' /x/ ' })] }, ARTICLE);
  assert.equal(e!.lemma, 'eloquent');
  assert.equal(e!.ipa, '/x/');
  assert.equal(e!.example, '');
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
  let sent!: JsonRequest;
  const client: JsonGenerator = { generateJson: async (r) => ((sent = r), { entries: [row()] }) };
  const out = await analyzeVocabulary(client, { url: '', title: 'T', text: ARTICLE }, { level: 'B2', nativeLanguage: 'X' });
  assert.equal(out.length, 1);
  assert.match(sent.messages[0]!.text, /Title: T/);
});

test('termKey ignores case, typographic apostrophes, dashes and spacing', () => {
  assert.equal(termKey(' Won’t  Back—Down '), "won't back-down");
});

test('findSurfaceForm returns the text as written, tolerating apostrophes, dashes and inflection', () => {
  const text = 'The beleaguered state‑run firm said it won’t back down.';
  assert.equal(findSurfaceForm(text, 'beleaguer'), 'beleaguered');
  assert.equal(findSurfaceForm(text, 'state-run'), 'state‑run');
  assert.equal(findSurfaceForm(text, "won't back down"), 'won’t back down');
  assert.equal(findSurfaceForm(text, 'run'), null); // not inside a hyphenated word
  assert.equal(findSurfaceForm(text, 'firmament'), null);
});

test('rows whose term is inflected or typographically different are kept, using the article form', () => {
  const text = 'The beleaguered mayor said it won’t matter.';
  const out = normalizeEntries(
    { entries: [{ term: 'beleaguer', lemma: 'beleaguer', meaning: '圍困' }, { term: "won't", meaning: '不會' }] },
    text,
  );
  assert.deepEqual(out.map((e) => e.term), ['beleaguered', 'won’t']);
  assert.equal(out[0]!.lemma, 'beleaguer');
});

test('the prompt asks for thorough coverage of rare words', () => {
  assert.match(buildVocabSystemPrompt({ level: 'B2', nativeLanguage: 'X' }), /rare, low-frequency/);
});

test('defineTerm keeps the selected text as the term and requires a meaning', async () => {
  let sent!: JsonRequest;
  const client: JsonGenerator = { generateJson: async (r) => ((sent = r), { lemma: 'herring', meaning: '轉移焦點' }) };
  const entry = await defineTerm(client, 'red herring', 'It was a red herring.', { level: 'B2', nativeLanguage: 'X', title: 'T' });
  assert.equal(entry.term, 'red herring');
  assert.equal(entry.meaning, '轉移焦點');
  assert.match(sent.messages[0]!.text, /Passage: "It was a red herring\."/);
  await assert.rejects(defineTerm({ generateJson: async () => ({}) }, 'x', 'x', { level: 'B2', nativeLanguage: 'X' }), /No explanation/);
});

test('findSurfaceForm accepts regular inflections only', () => {
  const t = 'They are teasing him; prices applied; it stopped; the artist quelled it.';
  assert.equal(findSurfaceForm(t, 'tease'), 'teasing');
  assert.equal(findSurfaceForm(t, 'apply'), 'applied');
  assert.equal(findSurfaceForm(t, 'stop'), 'stopped');
  assert.equal(findSurfaceForm(t, 'quell'), 'quelled');
  assert.equal(findSurfaceForm(t, 'art'), null);
});
