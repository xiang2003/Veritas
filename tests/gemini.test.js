import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiClient, GeminiError, parseJsonLoose } from '../src/lib/gemini.js';

const settings = async () => ({ apiKey: 'KEY', model: 'm1' });
const ok = (text) => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) });
const req = { system: 'sys', messages: [{ role: 'user', text: 'hi' }] };

test('sends key header, model url and system instruction', async () => {
  let call;
  const client = createGeminiClient({
    getSettings: settings,
    fetch: async (url, init) => ((call = { url, init }), ok('{"a":1}')),
  });
  assert.deepEqual(await client.generateJson(req), { a: 1 });
  assert.match(call.url, /models\/m1:generateContent$/);
  assert.equal(call.init.headers['x-goog-api-key'], 'KEY');
  const body = JSON.parse(call.init.body);
  assert.equal(body.systemInstruction.parts[0].text, 'sys');
  assert.equal(body.contents[0].role, 'user');
});

test('rejects when api key missing', async () => {
  const client = createGeminiClient({ getSettings: async () => ({ apiKey: '', model: 'm' }), fetch: async () => {} });
  await assert.rejects(client.generateJson(req), /API key/);
});

test('surfaces API error message and status', async () => {
  const client = createGeminiClient({
    getSettings: settings,
    fetch: async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'quota' } }) }),
  });
  await assert.rejects(client.generateJson(req), (e) => e instanceof GeminiError && e.status === 429 && e.message === 'quota');
});

test('reports blocked prompts and empty responses', async () => {
  const mk = (payload) => createGeminiClient({ getSettings: settings, fetch: async () => ({ ok: true, json: async () => payload }) });
  await assert.rejects(mk({ promptFeedback: { blockReason: 'SAFETY' } }).generateJson(req), /blocked: SAFETY/);
  await assert.rejects(mk({ candidates: [] }).generateJson(req), /empty/);
});

test('parseJsonLoose strips code fences and rejects garbage', () => {
  assert.deepEqual(parseJsonLoose('```json\n{"x":2}\n```'), { x: 2 });
  assert.throws(() => parseJsonLoose('nope'), /invalid JSON/);
});
