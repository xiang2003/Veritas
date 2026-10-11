import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTranslateSystemPrompt, translateParagraph } from '../src/lib/translate.ts';
import type { JsonGenerator, JsonRequest } from '../src/lib/gemini.ts';
import { createHandlers } from '../src/background/handlers.ts';
import { DEFAULT_SETTINGS } from '../src/lib/settings.ts';

const opts = { nativeLanguage: 'Traditional Chinese', title: 'Storm hits coast' };

test('prompt names the target language and article title', () => {
  const p = buildTranslateSystemPrompt(opts);
  assert.match(p, /Traditional Chinese/);
  assert.match(p, /Storm hits coast/);
});

test('returns the trimmed translation and sends the paragraph', async () => {
  let sent!: JsonRequest;
  const client: JsonGenerator = { generateJson: async (r) => ((sent = r), { translation: ' 風暴來襲 ' }) };
  assert.equal(await translateParagraph(client, 'A storm hit.', opts), '風暴來襲');
  assert.equal(sent.messages[0]!.text, 'A storm hit.');
});

test('rejects empty or malformed results', async () => {
  for (const raw of [{}, null, { translation: 3 }, { translation: '  ' }]) {
    await assert.rejects(translateParagraph({ generateJson: async () => raw }, 'x', opts), /empty/);
  }
});

const mem = () => ({ get: async () => ({}), set: async () => {} });
const handlersWith = (generateJson: JsonGenerator['generateJson']) =>
  createHandlers({
    client: { generateJson },
    getSettings: async () => ({ ...DEFAULT_SETTINGS, apiKey: 'k' }),
    cache: mem(),
    session: mem(),
  });

test('background handles translate requests and turns failures into error responses', async () => {
  const ok = await handlersWith(async () => ({ translation: '你好' })).handle({ type: 'translate', text: 'Hello', title: 'T' });
  assert.deepEqual(ok, { ok: true, translation: '你好' });
  const bad = await handlersWith(async () => {
    throw new Error('quota');
  }).handle({ type: 'translate', text: 'Hello', title: 'T' });
  assert.deepEqual(bad, { ok: false, error: 'quota' });
});
