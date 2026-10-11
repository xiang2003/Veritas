import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createController, type Phase, type SttLike, type View } from '../src/sidepanel/controller.ts';
import type { TutorTurn } from '../src/lib/tutor.ts';

const article = { url: 'u', title: 'Title', text: 'text' };
const turn = (reply: string): TutorTurn => ({ reply, corrections: [], betterAnswer: '', praise: '' });

function setup(sendImpl: (t: string) => Promise<TutorTurn> = async () => turn('ok')) {
  const log: string[] = [];
  const phases: Phase[] = [];
  const view: View = {
    setPhase: (p) => phases.push(p),
    setArticleTitle: (t) => log.push(`title:${t}`),
    clearConversation: () => log.push('clear'),
    setDraft: (t) => log.push(`draft:${t}`),
    addUserMessage: (t) => log.push(`user:${t}`),
    addTutorTurn: (t) => log.push(`tutor:${t.reply}`),
    showError: (m) => log.push(`error:${m}`),
  };
  let handlers!: Parameters<SttLike['start']>[0];
  const stt: SttLike = {
    supported: true,
    start: (h) => (handlers = h, log.push('stt:start')),
    stop: () => log.push('stt:stop'),
  };
  const spoken: string[] = [];
  const tts = { speak: async (t: string) => void spoken.push(t), stop: () => log.push('tts:stop') };
  const session = { start: async () => turn('hello'), send: sendImpl };
  const controller = createController({ createSession: () => session, stt, tts, view, getRate: () => 1 });
  return { controller, log, phases, spoken, handlers: () => handlers };
}

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
  assert.deepEqual(s.spoken, ['hello']);
  assert.deepEqual(s.phases.slice(-3), ['thinking', 'speaking', 'ready']);
});

test('typed submit shows user text then the tutor turn', async () => {
  const s = setup(async (t) => turn(`re:${t}`));
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

test('speech: final transcript is submitted once', async () => {
  const s = setup();
  s.controller.setArticle(article);
  s.controller.toggleMic();
  assert.equal(s.phases.at(-1), 'listening');
  s.handlers().onResult('hi there', false);
  s.handlers().onResult('hi there friend', true);
  s.handlers().onEnd();
  await new Promise((r) => setImmediate(r));
  assert.equal(s.log.filter((l) => l === 'user:hi there friend').length, 1);
  assert.equal(s.log.filter((l) => l.startsWith('user:')).length, 1);
});

test('speech: transcript is not lost when recognition ends without a final result', async () => {
  const s = setup();
  s.controller.setArticle(article);
  s.controller.toggleMic();
  s.handlers().onResult('half sentence', false);
  s.handlers().onEnd();
  await new Promise((r) => setImmediate(r));
  assert.ok(s.log.includes('user:half sentence'));
});

test('speech errors are surfaced and nothing is submitted', () => {
  const s = setup();
  s.controller.setArticle(article);
  s.controller.toggleMic();
  s.handlers().onError('denied');
  s.handlers().onEnd();
  assert.ok(s.log.includes('error:denied'));
  assert.equal(s.phases.at(-1), 'ready');
});

test('toggling the mic while listening stops recognition', () => {
  const s = setup();
  s.controller.setArticle(article);
  s.controller.toggleMic();
  s.controller.toggleMic();
  assert.ok(s.log.includes('stt:stop'));
});

test('tutor failure is shown and the panel recovers', async () => {
  const s = setup(async () => {
    throw new Error('quota');
  });
  s.controller.setArticle(article);
  await s.controller.submitText('hello');
  assert.ok(s.log.includes('error:quota'));
  assert.equal(s.phases.at(-1), 'ready');
});

test('new article resets the conversation and stops audio', () => {
  const s = setup();
  s.controller.setArticle(article);
  s.controller.setArticle({ ...article, url: 'v' });
  assert.equal(s.log.filter((l) => l === 'clear').length, 2);
  assert.ok(s.log.includes('tts:stop') && s.log.includes('stt:stop'));
});
