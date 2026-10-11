import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiClient, formatWait, GeminiError, parseJsonLoose, parseRetryDelayMs } from '../src/lib/gemini.ts';

const settings = async () => ({ apiKey: 'KEY', model: 'm1' });
const ok = (text: string) =>
  ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) }) as Response;
const req = { system: 'sys', messages: [{ role: 'user' as const, text: 'hi' }] };

test('sends key header, model url and system instruction', async () => {
  let call!: { url: string; init: RequestInit };
  const client = createGeminiClient({
    getSettings: settings,
    fetch: async (url, init) => ((call = { url: String(url), init: init! }), ok('{"a":1}')),
  });
  assert.deepEqual(await client.generateJson(req), { a: 1 });
  assert.match(call.url, /models\/m1:generateContent$/);
  assert.equal((call.init.headers as Record<string, string>)['x-goog-api-key'], 'KEY');
  const body = JSON.parse(call.init.body as string);
  assert.equal(body.systemInstruction.parts[0].text, 'sys');
  assert.equal(body.contents[0].role, 'user');
});

test('rejects when api key missing', async () => {
  const client = createGeminiClient({ getSettings: async () => ({ apiKey: '', model: 'm' }), fetch: async () => ok('{}') });
  await assert.rejects(client.generateJson(req), /API key/);
});

test('surfaces API error message and status', async () => {
  const client = createGeminiClient({
    getSettings: settings,
    fetch: async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'quota' } }) }) as Response,
    sleep: async () => {},
  });
  await assert.rejects(
    client.generateJson(req),
    (e: unknown) => e instanceof GeminiError && e.status === 429 && e.message === 'quota',
  );
});

test('reports blocked prompts and empty responses', async () => {
  const mk = (payload: object) =>
    createGeminiClient({ getSettings: settings, fetch: async () => ({ ok: true, json: async () => payload }) as Response });
  await assert.rejects(mk({ promptFeedback: { blockReason: 'SAFETY' } }).generateJson(req), /blocked: SAFETY/);
  await assert.rejects(mk({ candidates: [] }).generateJson(req), /empty/);
});

test('parseJsonLoose strips code fences and rejects garbage', () => {
  assert.deepEqual(parseJsonLoose('```json\n{"x":2}\n```'), { x: 2 });
  assert.throws(() => parseJsonLoose('nope'), /invalid JSON/);
});

test('audio is sent as an inline_data part before the text', async () => {
  let body: any;
  const client = createGeminiClient({
    getSettings: settings,
    fetch: async (_url, init) => ((body = JSON.parse(init!.body as string)), ok('{}')),
  });
  await client.generateJson({ system: 's', messages: [{ role: 'user', text: 'say', audio: { mimeType: 'audio/webm', data: 'AAA' } }] });
  assert.deepEqual(body.contents[0].parts, [{ inline_data: { mime_type: 'audio/webm', data: 'AAA' } }, { text: 'say' }]);
});

const failing = (status: number) => ({ ok: false, status, json: async () => ({ error: { message: `E${status}` } }) }) as Response;

test('retries overloaded responses with backoff, then succeeds', async () => {
  const replies = [failing(503), failing(503), ok('{"a":1}')];
  const waits: number[] = [];
  const client = createGeminiClient({
    getSettings: settings,
    fetch: async () => replies.shift()!,
    sleep: async (ms) => void waits.push(ms),
  });
  assert.deepEqual(await client.generateJson(req), { a: 1 });
  assert.deepEqual(waits, [1000, 2000]);
});

test('gives up after three attempts and reports the last error', async () => {
  let calls = 0;
  const client = createGeminiClient({
    getSettings: settings,
    fetch: async () => (calls++, failing(503)),
    sleep: async () => {},
  });
  await assert.rejects(client.generateJson(req), (e: unknown) => e instanceof GeminiError && e.status === 503);
  assert.equal(calls, 3);
});

test('does not retry client errors such as an invalid key', async () => {
  let calls = 0;
  const client = createGeminiClient({
    getSettings: settings,
    fetch: async () => (calls++, failing(400)),
    sleep: async () => {},
  });
  await assert.rejects(client.generateJson(req), /E400/);
  assert.equal(calls, 1);
});

test('parseRetryDelayMs reads Google retry hints', () => {
  assert.equal(parseRetryDelayMs('x Please retry in 4h14m50.5s. y'), (4 * 3600 + 14 * 60 + 50.5) * 1000);
  assert.equal(parseRetryDelayMs('retry in 20s'), 20_000);
  assert.equal(parseRetryDelayMs('no hint'), undefined);
});

test('formatWait is human readable', () => {
  assert.equal(formatWait(20_000), '20 秒');
  assert.equal(formatWait(25 * 60_000), '25 分鐘');
  assert.equal(formatWait((4 * 60 + 15) * 60_000), '4 小時 15 分');
});

const quota = (retry: string) =>
  ({ ok: false, status: 429, json: async () => ({ error: { message: `Quota exceeded. Please retry in ${retry}.` } }) }) as Response;

test('a used-up quota is reported in Chinese without wasting retries', async () => {
  let calls = 0;
  const client = createGeminiClient({
    getSettings: settings,
    fetch: async () => (calls++, quota('4h14m50s')),
    sleep: async () => {
      throw new Error('must not wait');
    },
  });
  await assert.rejects(client.generateJson(req), (e: unknown) => e instanceof GeminiError && e.status === 429 && /免費額度已用完（m1）.*4 小時 15 分/.test(e.message));
  assert.equal(calls, 1);
});

test('a short rate-limit hint is waited out and retried', async () => {
  const replies = [quota('5s'), ok('{"a":1}')];
  const waits: number[] = [];
  const client = createGeminiClient({
    getSettings: settings,
    fetch: async () => replies.shift()!,
    sleep: async (ms) => void waits.push(ms),
  });
  assert.deepEqual(await client.generateJson(req), { a: 1 });
  assert.deepEqual(waits, [5000]);
});
