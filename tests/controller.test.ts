import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createController, type Phase, type View } from '../src/sidepanel/controller.ts';
import type { RecorderHandlers, RecorderLike } from '../src/lib/recorder.ts';
import type { TutorTurn } from '../src/lib/tutor.ts';

const article = { url: 'u', title: 'Title', text: 'text' };
const clip = { mimeType: 'audio/webm', data: 'AAA' };
const turn = (reply: string, transcript = ''): TutorTurn => ({
  transcript, reply, corrections: [], betterAnswer: '', pronunciation: '', praise: '',
});

function setup(overrides: { sendAudio?: () => Promise<TutorTurn> } = {}) {
  const log: string[] = [];
  const phases: Phase[] = [];
  const view: View = {
    setPhase: (p) => phases.push(p),
    setArticleTitle: (t) => log.push(`title:${t}`),
    clearConversation: () => log.push('clear'),
    addUserMessage: (t) => log.push(`user:${t}`),
    addTutorTurn: (t) => log.push(`tutor:${t.reply}`),
    showError: (m) => log.push(`error:${m}`),
  };
  let handlers!: RecorderHandlers;
  const recorder: RecorderLike = {
    start: (h) => ((handlers = h), void log.push('rec:start')),
    stop: () => void log.push('rec:stop'),
  };
  const spoken: string[] = [];
  const tts = { speak: async (t: string) => void spoken.push(t), stop: () => void log.push('tts:stop') };
  const session = {
    start: async () => turn('hello'),
    send: async (t: string) => turn(`re:${t}`, t),
    sendAudio: overrides.sendAudio ?? (async () => turn('nice', 'i goed there')),
  };
  const controller = createController({ createSession: () => session, recorder, tts, view, getRate: () => 1 });
  return { controller, log, phases, spoken, handlers: () => handlers };
}

const tick = () => new Promise((r) => setImmediate(r));

test('setArticle(null) shows the no-article state', () => {
  const s = setup();
  s.controller.setArticle(null);
  assert.equal(s.phases.at(-1), 'no-article');
});

test('start shows the opening turn, speaks it and returns to ready', async () => {
  const s = setup();
  s.controller.setArticle(article);
  await s.controller.start();
  assert.ok(s.log.includes('tutor:hello'));
  assert.ok(!s.log.some((l) => l.startsWith('user:')));
  assert.deepEqual(s.spoken, ['hello']);
  assert.deepEqual(s.phases.slice(-3), ['thinking', 'speaking', 'ready']);
});

test('typed submit shows user text then the tutor turn', async () => {
  const s = setup();
  s.controller.setArticle(article);
  await s.controller.submitText('  my answer ');
  assert.deepEqual(s.log.filter((l) => /^(user|tutor):/.test(l)), ['user:my answer', 'tutor:re:my answer']);
});

test('blank submit does nothing', async () => {
  const s = setup();
  s.controller.setArticle(article);
  await s.controller.submitText('   ');
  assert.equal(s.log.filter((l) => l.startsWith('user:')).length, 0);
});

test('spoken answer: recording is sent to the tutor and the transcript is shown', async () => {
  const s = setup();
  s.controller.setArticle(article);
  s.controller.toggleMic();
  assert.equal(s.phases.at(-1), 'listening');
  s.handlers().onClip(clip);
  await tick();
  assert.deepEqual(s.log.filter((l) => /^(user|tutor):/.test(l)), ['user:i goed there', 'tutor:nice']);
  assert.equal(s.phases.at(-1), 'ready');
});

test('pressing the mic while recording stops the recorder', () => {
  const s = setup();
  s.controller.setArticle(article);
  s.controller.toggleMic();
  s.controller.toggleMic();
  assert.equal(s.log.filter((l) => l === 'rec:stop').length, 2); // setArticle() + the toggle
});

test('silence-only recording reports no speech and recovers', () => {
  const s = setup();
  s.controller.setArticle(article);
  s.controller.toggleMic();
  s.handlers().onClip(null);
  assert.ok(s.log.includes('error:No speech detected. Try again.'));
  assert.equal(s.phases.at(-1), 'ready');
});

test('microphone errors are surfaced and the panel recovers', () => {
  const s = setup();
  s.controller.setArticle(article);
  s.controller.toggleMic();
  s.handlers().onError('denied');
  assert.ok(s.log.includes('error:denied'));
  assert.equal(s.phases.at(-1), 'ready');
});

test('tutor failure is shown and the panel recovers', async () => {
  const s = setup({
    sendAudio: async () => {
      throw new Error('quota');
    },
  });
  s.controller.setArticle(article);
  s.controller.toggleMic();
  s.handlers().onClip(clip);
  await tick();
  assert.ok(s.log.includes('error:quota'));
  assert.equal(s.phases.at(-1), 'ready');
});

test('new article resets the conversation and stops audio', () => {
  const s = setup();
  s.controller.setArticle(article);
  s.controller.setArticle({ ...article, url: 'v' });
  assert.equal(s.log.filter((l) => l === 'clear').length, 2);
  assert.ok(s.log.includes('tts:stop') && s.log.includes('rec:stop'));
});
