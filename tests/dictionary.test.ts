import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cambridgeUrl, lookupPronunciation, parseFreeDictionary } from '../src/lib/dictionary.ts';

test('cambridgeUrl lowercases and hyphenates phrases', () => {
  assert.equal(cambridgeUrl('Eloquent'), 'https://dictionary.cambridge.org/dictionary/english/eloquent');
  assert.equal(cambridgeUrl(' red  herring '), 'https://dictionary.cambridge.org/dictionary/english/red-herring');
});

const sample = [
  {
    word: 'tomato',
    phonetic: '/təˈmeɪtoʊ/',
    phonetics: [
      { text: '/təˈmɑːtəʊ/', audio: 'https://api.dictionaryapi.dev/media/pronunciations/en/tomato-uk.mp3' },
      { text: '/təˈmeɪtoʊ/', audio: 'https://api.dictionaryapi.dev/media/pronunciations/en/tomato-us.mp3' },
      { text: '/x/', audio: '' },
    ],
  },
];

test('prefers the US recording and its IPA', () => {
  assert.deepEqual(parseFreeDictionary(sample), {
    ipa: '/təˈmeɪtoʊ/',
    audioUrl: 'https://api.dictionaryapi.dev/media/pronunciations/en/tomato-us.mp3',
  });
});

test('falls back to any audio, then to IPA only, then null', () => {
  const uk = [{ phonetics: [{ text: '/a/', audio: 'https://x/a-uk.mp3' }] }];
  assert.equal(parseFreeDictionary(uk)!.audioUrl, 'https://x/a-uk.mp3');
  assert.deepEqual(parseFreeDictionary([{ phonetic: '/b/', phonetics: [] }]), { ipa: '/b/', audioUrl: '' });
  assert.equal(parseFreeDictionary([{ phonetics: [] }]), null);
  assert.equal(parseFreeDictionary({ title: 'No Definitions Found' }), null);
});

test('lookup returns null for unknown words and throws on server errors', async () => {
  let url = '';
  const ok = await lookupPronunciation(async (u) => ((url = String(u)), { ok: true, status: 200, json: async () => sample }) as Response, ' Tomato ');
  assert.equal(url, 'https://api.dictionaryapi.dev/api/v2/entries/en/tomato');
  assert.ok(ok?.audioUrl);
  assert.equal(await lookupPronunciation(async () => ({ ok: false, status: 404 }) as Response, 'zzz'), null);
  await assert.rejects(lookupPronunciation(async () => ({ ok: false, status: 500 }) as Response, 'x'), /500/);
});
