import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiClient, formatWait, GeminiError, parseJsonLoose, parseRetryDelayMs } from '../src/lib/gemini.ts';
import { BALANCED_MODEL, LIGHT_MODEL, QUALITY_MODEL, TASK_MODELS } from '../src/lib/models.ts';

const settings = async () => ({ apiKey: 'KEY' });
const ok = (text: string) =>
  ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) }) as Response;
const failing = (status: number, message = `E${status}`) =>
  ({ ok: false, status, json: async () => ({ error: { message } }) }) as Response;
const quota = (retry: string) => failing(429, `Quota exceeded. Please retry in ${retry}.`);
const req = { task: 'tutor' as const, system: 'sys', messages: [{ role: 'user' as const, text: 'hi' }] };
/** Single-model routes keep the retry tests independent of the fallback logic. */
const single = { vocabulary: ['m1'], tutor: ['m1'], transcribe: ['m1'], translate: ['m1'], define: ['m1'], recommend: ['m1'], summarize: ['m1'] };
const pair = { ...single, tutor: ['main', 'backup'] };
const modelOf = (url: unknown) => /models\/([^:]+):/.exec(String(url))![1]!;
const noWait = async () => {};

test('sends key header, model url and system instruction', async () => {
  let call!: { url: string; init: RequestInit };
  const client = createGeminiClient({
    getSettings: settings,
    routes: single,
    fetch: async (url, init) => ((call = { url: String(url), init: init! }), ok('{"a":1}')),
  });
  assert.deepEqual(await client.generateJson(req), { a: 1 });
  assert.match(call.url, /models\/m1:generateContent$/);
  assert.equal((call.init.headers as Record<string, string>)['x-goog-api-key'], 'KEY');
  const body = JSON.parse(call.init.body as string);
  assert.equal(body.systemInstruction.parts[0].text, 'sys');
  assert.equal(body.contents[0].role, 'user');
});

test('each task goes to its model: quality for analysis and tutor, balanced for transcription, light for the rest', async () => {
  const used: string[] = [];
  const client = createGeminiClient({ getSettings: settings, fetch: async (url) => (used.push(modelOf(url)), ok('{}')) });
  for (const task of ['vocabulary', 'tutor', 'transcribe', 'translate', 'define', 'recommend'] as const) {
    await client.generateJson({ ...req, task });
  }
  assert.deepEqual(used, [QUALITY_MODEL, QUALITY_MODEL, BALANCED_MODEL, LIGHT_MODEL, LIGHT_MODEL, LIGHT_MODEL]);
  // Every task can fall back to all three models.
  for (const models of Object.values(TASK_MODELS)) {
    assert.deepEqual([...models].sort(), [BALANCED_MODEL, LIGHT_MODEL, QUALITY_MODEL].sort());
  }
});

test('rejects when api key missing', async () => {
  const client = createGeminiClient({ getSettings: async () => ({ apiKey: '' }), fetch: async () => ok('{}') });
  await assert.rejects(client.generateJson(req), /API key/);
});

test('surfaces API error message and status', async () => {
  const client = createGeminiClient({ getSettings: settings, routes: single, sleep: noWait, fetch: async () => failing(429, 'quota') });
  await assert.rejects(
    client.generateJson(req),
    (e: unknown) => e instanceof GeminiError && e.status === 429 && e.message === 'quota',
  );
});

test('reports blocked prompts and empty responses', async () => {
  const mk = (payload: object) =>
    createGeminiClient({
      getSettings: settings,
      routes: single,
      fetch: async () => ({ ok: true, json: async () => payload }) as Response,
    });
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
    routes: single,
    fetch: async (_url, init) => ((body = JSON.parse(init!.body as string)), ok('{}')),
  });
  await client.generateJson({ ...req, messages: [{ role: 'user', text: 'say', audio: { mimeType: 'audio/webm', data: 'AAA' } }] });
  assert.deepEqual(body.contents[0].parts, [{ inline_data: { mime_type: 'audio/webm', data: 'AAA' } }, { text: 'say' }]);
});

test('retries overloaded responses with backoff, then succeeds', async () => {
  const replies = [failing(503), failing(503), ok('{"a":1}')];
  const waits: number[] = [];
  const client = createGeminiClient({
    getSettings: settings,
    routes: single,
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
    routes: single,
    sleep: noWait,
    fetch: async () => (calls++, failing(503)),
  });
  await assert.rejects(client.generateJson(req), (e: unknown) => e instanceof GeminiError && e.status === 503);
  assert.equal(calls, 3);
});

test('does not retry or fall back on client errors such as an invalid key', async () => {
  let calls = 0;
  const client = createGeminiClient({
    getSettings: settings,
    routes: pair,
    sleep: noWait,
    fetch: async () => (calls++, failing(400, 'API key not valid')),
  });
  await assert.rejects(client.generateJson(req), /API key not valid/);
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

test('a short rate-limit hint is waited out and retried on the same model', async () => {
  const replies = [quota('5s'), ok('{"a":1}')];
  const waits: number[] = [];
  const client = createGeminiClient({
    getSettings: settings,
    routes: pair,
    fetch: async () => replies.shift()!,
    sleep: async (ms) => void waits.push(ms),
  });
  assert.deepEqual(await client.generateJson(req), { a: 1 });
  assert.deepEqual(waits, [5000]);
});

test('a used-up quota falls back to the other model without wasting retries', async () => {
  const used: string[] = [];
  const client = createGeminiClient({
    getSettings: settings,
    routes: pair,
    sleep: async () => assert.fail('must not wait'),
    fetch: async (url) => (used.push(modelOf(url)), modelOf(url) === 'main' ? quota('4h14m50s') : ok('{"from":"backup"}')),
  });
  assert.deepEqual(await client.generateJson(req), { from: 'backup' });
  assert.deepEqual(used, ['main', 'backup']);
});

test('a model known to be used up is skipped until its quota resets', async () => {
  let clock = 0;
  const used: string[] = [];
  const client = createGeminiClient({
    getSettings: settings,
    routes: pair,
    now: () => clock,
    fetch: async (url) => (used.push(modelOf(url)), modelOf(url) === 'main' && clock < 60_000 ? quota('1m') : ok('{}')),
  });
  await client.generateJson(req);
  await client.generateJson(req);
  assert.deepEqual(used, ['main', 'backup', 'backup']); // the second call skips 'main' without a request
  clock = 61_000;
  await client.generateJson(req);
  assert.equal(used.at(-1), 'main'); // reset passed: back to the main model
});

test('when every model is out of quota, the error names them and the earliest reset', async () => {
  const client = createGeminiClient({
    getSettings: settings,
    routes: pair,
    now: () => 0,
    fetch: async (url) => (modelOf(url) === 'main' ? quota('4h') : quota('2h15m')),
  });
  await assert.rejects(
    client.generateJson(req),
    (e: unknown) => e instanceof GeminiError && e.status === 429 && /免費額度已用完（main、backup）.*2 小時 15 分/.test(e.message),
  );
});

test('once all models are known to be used up, no further requests are sent', async () => {
  let calls = 0;
  const client = createGeminiClient({ getSettings: settings, routes: single, now: () => 0, fetch: async () => (calls++, quota('1h')) });
  await assert.rejects(client.generateJson(req), /免費額度已用完（m1）/);
  await assert.rejects(client.generateJson(req), /免費額度已用完（m1）/);
  assert.equal(calls, 1);
});

test('an unavailable model or persistent overload falls back to the other model', async () => {
  const bads = [
    failing(404, 'models/main is not found'),
    failing(400, 'This model is no longer available to new users'),
    failing(503),
  ];
  for (const bad of bads) {
    const client = createGeminiClient({
      getSettings: settings,
      routes: pair,
      sleep: noWait,
      fetch: async (url) => (modelOf(url) === 'main' ? bad : ok('{"ok":1}')),
    });
    assert.deepEqual(await client.generateJson(req), { ok: 1 });
  }
});
