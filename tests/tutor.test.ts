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
