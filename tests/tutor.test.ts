import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTutorSystemPrompt, parseTutorTurn, createTutorSession, START_SIGNAL } from '../src/lib/tutor.ts';
import type { JsonGenerator, JsonRequest } from '../src/lib/gemini.ts';

const article = { url: 'u', title: 'Storm hits coast', text: 'A powerful storm hit the coast.' };
const opts = { level: 'B2', nativeLanguage: 'Traditional Chinese' };
const good = { reply: 'Hi! What surprised you?', corrections: [], betterAnswer: '', praise: '' };

test('system prompt embeds article, level and language', () => {
  const p = buildTutorSystemPrompt(article, opts);
  for (const s of ['Storm hits coast', 'powerful storm', 'B2', 'Traditional Chinese', START_SIGNAL]) assert.ok(p.includes(s), s);
});

test('parseTutorTurn trims and drops incomplete corrections', () => {
  const turn = parseTutorTurn({
    reply: ' Nice. ',
    corrections: [{ original: 'I go', corrected: 'I went', explanation: '時態' }, { original: '', corrected: 'x' }, null],
    betterAnswer: ' Better. ',
  });
  assert.equal(turn.reply, 'Nice.');
  assert.equal(turn.corrections.length, 1);
  assert.equal(turn.betterAnswer, 'Better.');
  assert.equal(turn.praise, '');
});

test('parseTutorTurn rejects a response without reply', () => {
  assert.throws(() => parseTutorTurn({ corrections: [] }), /no reply/);
  assert.throws(() => parseTutorTurn(null), /no reply/);
});

test('session accumulates history and sends it on each call', async () => {
  const sent: JsonRequest[] = [];
  const client: JsonGenerator = { generateJson: async (r) => (sent.push(structuredClone(r)), good) };
  const s = createTutorSession(client, article, opts);
  await s.start();
  await s.send('I think it is scary');
  assert.equal(s.length, 4);
  assert.deepEqual(sent[0]!.messages.map((m) => m.text), [START_SIGNAL]);
  assert.deepEqual(sent[1]!.messages.map((m) => m.role), ['user', 'model', 'user']);
});

test('failed call does not pollute history, so it can be retried', async () => {
  let fail = true;
  const client: JsonGenerator = {
    generateJson: async () => {
      if (fail) throw new Error('boom');
      return good;
    },
  };
  const s = createTutorSession(client, article, opts);
  await assert.rejects(s.send('hello'), /boom/);
  assert.equal(s.length, 0);
  fail = false;
  await s.send('hello');
  assert.equal(s.length, 2);
});

const clip = { mimeType: 'audio/webm', data: 'AAA' };

test('parseTutorTurn reads transcript and pronunciation', () => {
  const turn = parseTutorTurn({ ...good, transcript: ' i goed ', pronunciation: ' storm ' });
  assert.equal(turn.transcript, 'i goed');
  assert.equal(turn.pronunciation, 'storm');
});

test('sendAudio attaches the clip, then keeps only the transcript in history', async () => {
  const sent: JsonRequest[] = [];
  const client: JsonGenerator = {
    generateJson: async (r) => (sent.push(structuredClone(r)), { ...good, transcript: 'i goed there' }),
  };
  const s = createTutorSession(client, article, opts);
  const turn = await s.sendAudio(clip);
  assert.equal(turn.transcript, 'i goed there');
  assert.deepEqual(sent[0]!.messages[0]!.audio, clip);
  await s.send('next');
  assert.equal(sent[1]!.messages[0]!.audio, undefined);
  assert.equal(sent[1]!.messages[0]!.text, 'i goed there');
});

test('typed answers echo the typed text as transcript', async () => {
  const client: JsonGenerator = { generateJson: async () => good };
  const turn = await createTutorSession(client, article, opts).send('hello there');
  assert.equal(turn.transcript, 'hello there');
});

test('system prompt demands a verbatim transcript', () => {
  assert.match(buildTutorSystemPrompt(article, opts), /word for word/);
});

test('a session can resume from saved history and exposes it for saving', async () => {
  const sent: JsonRequest[] = [];
  const client: JsonGenerator = { generateJson: async (r) => (sent.push(structuredClone(r)), good) };
  const saved = [
    { role: 'model' as const, text: 'Hi!' },
    { role: 'user' as const, text: 'hello' },
  ];
  const s = createTutorSession(client, article, opts, saved);
  await s.send('again');
  assert.deepEqual(sent[0]!.messages.map((m) => m.text), ['Hi!', 'hello', 'again']);
  assert.equal(s.history.length, 4);
  s.history.pop(); // the returned copy must not mutate the session
  assert.equal(s.history.length, 4);
});
