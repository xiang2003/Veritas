import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTranscribeSystemPrompt, transcribeSpeech } from '../src/lib/transcribe.ts';
import type { JsonGenerator } from '../src/lib/gemini.ts';

const clip = { mimeType: 'audio/webm', data: 'AAA' };
const reply = (raw: unknown): JsonGenerator => ({ generateJson: async () => raw });

test('the prompt demands verbatim text, marks unclear words and forbids guessing', () => {
  const p = buildTranscribeSystemPrompt('Traditional Chinese');
  assert.match(p, /word for word/);
  assert.match(p, /\[inaudible\]/);
  assert.match(p, /never guess words/);
  assert.match(p, /Traditional Chinese/);
});

test('returns the trimmed transcript and pronunciation notes', async () => {
  const t = await transcribeSpeech(reply({ transcript: ' I goed there ', pronunciation: ' th ' }), clip, { nativeLanguage: 'X' });
  assert.deepEqual(t, { transcript: 'I goed there', pronunciation: 'th' });
});

test('keeps partly inaudible speech but drops recordings with no usable words', async () => {
  const partial = await transcribeSpeech(reply({ transcript: 'I think [inaudible] is good' }), clip, { nativeLanguage: 'X' });
  assert.equal(partial.transcript, 'I think [inaudible] is good');
  const none = await transcribeSpeech(reply({ transcript: '[inaudible]', pronunciation: 'x' }), clip, { nativeLanguage: 'X' });
  assert.deepEqual(none, { transcript: '', pronunciation: '' });
  assert.deepEqual(await transcribeSpeech(reply(null), clip, { nativeLanguage: 'X' }), { transcript: '', pronunciation: '' });
});
