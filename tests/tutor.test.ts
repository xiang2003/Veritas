import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTutorSystemPrompt, parseTutorTurn, createTutorSession, SPOKEN_PREFIX, START_SIGNAL } from '../src/lib/tutor.ts';
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

test('the tutor never supplies transcript or pronunciation itself', () => {
  const turn = parseTutorTurn({ ...good, transcript: 'invented', pronunciation: 'invented' });
  assert.equal(turn.transcript, '');
  assert.equal(turn.pronunciation, '');
});

/** Fake client: answers the transcription call and the tutor call differently. */
function twoStepClient(transcription: object) {
  const sent: JsonRequest[] = [];
  const client: JsonGenerator = {
    generateJson: async (r) => {
      sent.push(structuredClone(r));
      return r.messages.some((m) => m.audio) ? transcription : good;
    },
  };
  return { client, sent };
}

test('speech is transcribed in a separate call that sees no article or conversation', async () => {
  const { client, sent } = twoStepClient({ transcript: 'i goed there um yesterday', pronunciation: '"there" 的 th 要咬舌' });
  const s = createTutorSession(client, article, opts);
  await s.start();
  const turn = await s.sendAudio(clip);

  const transcription = sent[1]!;
  assert.deepEqual(transcription.messages.length, 1); // no history
  assert.deepEqual(transcription.messages[0]!.audio, clip);
  assert.ok(!transcription.system.includes(article.title)); // no article
  assert.equal(transcription.temperature, 0);

  const tutor = sent[2]!;
  assert.ok(tutor.messages.every((m) => !m.audio)); // the tutor only gets text
  assert.equal(tutor.messages.at(-1)!.text, `${SPOKEN_PREFIX}i goed there um yesterday`);

  assert.equal(turn.transcript, 'i goed there um yesterday');
  assert.equal(turn.pronunciation, '"there" 的 th 要咬舌');
  assert.equal(turn.reply, good.reply);
});

test('no usable speech fails before the tutor is asked, and history stays clean', async () => {
  const { client, sent } = twoStepClient({ transcript: ' [inaudible] [inaudible] ' });
  const s = createTutorSession(client, article, opts);
  await assert.rejects(s.sendAudio(clip), /沒有聽清楚/);
  assert.equal(sent.length, 1);
  assert.equal(s.length, 0);
});

test('typed answers echo the typed text as transcript', async () => {
  const client: JsonGenerator = { generateJson: async () => good };
  const turn = await createTutorSession(client, article, opts).send('hello there');
  assert.equal(turn.transcript, 'hello there');
});

test('the tutor is told how to treat speech transcripts', () => {
  const p = buildTutorSystemPrompt(article, opts);
  assert.match(p, /do not list fillers/);
  assert.match(p, /\[inaudible\]/);
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

test('the tutor leads with concrete, guided questions and gives hints', () => {
  const p = buildTutorSystemPrompt(article, opts);
  assert.match(p, /You lead the conversation/);
  assert.match(p, /two options/);
  assert.match(p, /"hints"/);
});

test('parseTutorTurn keeps at most three non-empty hints', () => {
  const turn = parseTutorTurn({ ...good, hints: [' The article says that… ', '', 3, 'I think…', 'Maybe…', 'Also…'] });
  assert.deepEqual(turn.hints, ['The article says that…', 'I think…', 'Maybe…']);
  assert.deepEqual(parseTutorTurn(good).hints, []);
});
