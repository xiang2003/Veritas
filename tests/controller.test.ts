import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createController,
  type ConversationStore,
  type Phase,
  type SavedConversation,
  type View,
} from '../src/sidepanel/controller.ts';
import type { RecorderHandlers, RecorderLike } from '../src/lib/recorder.ts';
import type { ChatMessage } from '../src/lib/gemini.ts';
import type { TutorTurn } from '../src/lib/tutor.ts';

const article = { url: 'u', title: 'Title', text: 'text' };
const other = { url: 'v', title: 'Other', text: 'text' };
const clip = { mimeType: 'audio/webm', data: 'AAA' };
const turn = (reply: string, transcript = ''): TutorTurn => ({
  transcript, reply, corrections: [], betterAnswer: '', pronunciation: '', praise: '', hints: [], usedWords: [],
});
const tick = () => new Promise((r) => setImmediate(r));

function setup(overrides: { sendAudio?: () => Promise<TutorTurn>; send?: (t: string) => Promise<TutorTurn> } = {}) {
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

  const saved = new Map<string, SavedConversation>();
  const store: ConversationStore = {
    load: async (url) => saved.get(url) ?? null,
    save: async (url, c) => void saved.set(url, structuredClone(c)),
  };
  const created: ChatMessage[][] = [];
  const createSession = (_a: unknown, history: ChatMessage[]) => {
    created.push(history);
    const own: ChatMessage[] = [...history];
    return {
      get history() {
        return [...own];
      },
      start: async () => (own.push({ role: 'model', text: 'hello' }), turn('hello')),
      send:
        overrides.send ??
        (async (t: string) => (own.push({ role: 'user', text: t }, { role: 'model', text: `re:${t}` }), turn(`re:${t}`, t))),
      sendAudio: overrides.sendAudio ?? (async () => turn('nice', 'i goed there')),
    };
  };
  const controller = createController({ createSession, store, recorder, tts, view, getRate: () => 1 });
  return { controller, log, phases, spoken, saved, created, handlers: () => handlers };
}

test('setArticle(null) shows the no-article state', async () => {
  const s = setup();
  await s.controller.setArticle(null);
  assert.equal(s.phases.at(-1), 'no-article');
});

test('start shows the opening turn, speaks it and returns to ready', async () => {
  const s = setup();
  await s.controller.setArticle(article);
  await s.controller.start();
  assert.ok(s.log.includes('tutor:hello'));
  assert.ok(!s.log.some((l) => l.startsWith('user:')));
  assert.deepEqual(s.spoken, ['hello']);
  assert.deepEqual(s.phases.slice(-3), ['thinking', 'speaking', 'ready']);
});

test('typed submit shows user text then the tutor turn', async () => {
  const s = setup();
  await s.controller.setArticle(article);
  await s.controller.submitText('  my answer ');
  assert.deepEqual(s.log.filter((l) => /^(user|tutor):/.test(l)), ['user:my answer', 'tutor:re:my answer']);
});

test('blank submit does nothing', async () => {
  const s = setup();
  await s.controller.setArticle(article);
  await s.controller.submitText('   ');
  assert.equal(s.log.filter((l) => l.startsWith('user:')).length, 0);
});

test('spoken answer: recording is sent to the tutor and the transcript is shown', async () => {
  const s = setup();
  await s.controller.setArticle(article);
  s.controller.toggleMic();
  assert.equal(s.phases.at(-1), 'listening');
  s.handlers().onClip(clip);
  await tick();
  assert.deepEqual(s.log.filter((l) => /^(user|tutor):/.test(l)), ['user:i goed there', 'tutor:nice']);
  assert.equal(s.phases.at(-1), 'ready');
});

test('pressing the mic while recording stops the recorder', async () => {
  const s = setup();
  await s.controller.setArticle(article);
  s.controller.toggleMic();
  s.controller.toggleMic();
  assert.equal(s.log.filter((l) => l === 'rec:stop').length, 2); // setArticle() + the toggle
});

test('silence-only recording reports no speech and recovers', async () => {
  const s = setup();
  await s.controller.setArticle(article);
  s.controller.toggleMic();
  s.handlers().onClip(null);
  assert.ok(s.log.includes('error:No speech detected. Try again.'));
  assert.equal(s.phases.at(-1), 'ready');
});

test('microphone errors are surfaced and the panel recovers', async () => {
  const s = setup();
  await s.controller.setArticle(article);
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
  await s.controller.setArticle(article);
  s.controller.toggleMic();
  s.handlers().onClip(clip);
  await tick();
  assert.ok(s.log.includes('error:quota'));
  assert.equal(s.phases.at(-1), 'ready');
});

test('switching articles stops audio and clears the view', async () => {
  const s = setup();
  await s.controller.setArticle(article);
  await s.controller.setArticle(other);
  assert.equal(s.log.filter((l) => l === 'clear').length, 2);
  assert.ok(s.log.includes('tts:stop') && s.log.includes('rec:stop'));
});

test('conversation is restored when returning to an article, with the model history', async () => {
  const s = setup();
  await s.controller.setArticle(article);
  await s.controller.start();
  await s.controller.submitText('my answer');
  await s.controller.setArticle(other); // switch away
  s.log.length = 0;

  await s.controller.setArticle(article); // and back
  assert.deepEqual(s.log.filter((l) => /^(user|tutor):/.test(l)), ['tutor:hello', 'user:my answer', 'tutor:re:my answer']);
  assert.equal(s.created.at(-1)!.length, 3); // session resumed with previous messages
  assert.equal(s.phases.at(-1), 'ready');
});

test('a different article does not see the other conversation', async () => {
  const s = setup();
  await s.controller.setArticle(article);
  await s.controller.submitText('hi');
  s.log.length = 0;
  await s.controller.setArticle(other);
  assert.ok(!s.log.some((l) => /^(user|tutor):/.test(l)));
  assert.deepEqual(s.created.at(-1), []);
});

test('a reply that arrives after switching away is saved but not drawn on the new article', async () => {
  let release!: () => void;
  const s = setup({ send: (t) => new Promise((r) => (release = () => r(turn('late', t)))) });
  await s.controller.setArticle(article);
  const pending = s.controller.submitText('slow question');
  await tick();
  await s.controller.setArticle(other);
  s.log.length = 0;

  release();
  await pending;
  assert.deepEqual(s.log.filter((l) => /^(user|tutor|error):/.test(l)), []);
  assert.equal(s.phases.at(-1), 'ready'); // the new article's state was not clobbered
  assert.deepEqual(s.saved.get('u')!.items.map((i) => i.kind), ['user', 'tutor']);
});

test('a failing store does not break the conversation', async () => {
  const s = setup();
  const controller = createController({
    createSession: () => ({ history: [], start: async () => turn('x'), send: async () => turn('ok', 'q'), sendAudio: async () => turn('x') }),
    store: { load: async () => { throw new Error('nope'); }, save: async () => { throw new Error('nope'); } },
    recorder: { start() {}, stop() {} },
    tts: { speak: async () => {}, stop() {} },
    view: { setPhase() {}, setArticleTitle() {}, clearConversation() {}, addUserMessage() {}, addTutorTurn: (t) => s.log.push(`tutor:${t.reply}`), showError: (m) => s.log.push(`error:${m}`) },
    getRate: () => 1,
  });
  await controller.setArticle(article);
  await controller.submitText('q');
  assert.deepEqual(s.log, ['tutor:ok']);
});

test('a new article opens with the tutor question when autoStart is on; saved ones do not restart', async () => {
  const saved = new Map<string, SavedConversation>();
  let starts = 0;
  const controller = createController({
    createSession: () => ({
      history: [],
      start: async () => (starts++, turn('What happened in the article?')),
      send: async (t) => turn('ok', t),
      sendAudio: async () => turn('x'),
    }),
    store: { load: async (url) => saved.get(url) ?? null, save: async (url, c) => void saved.set(url, c) },
    recorder: { start() {}, stop() {} },
    tts: { speak: async () => {}, stop() {} },
    view: { setPhase() {}, setArticleTitle() {}, clearConversation() {}, addUserMessage() {}, addTutorTurn() {}, showError() {} },
    getRate: () => 1,
    autoStart: () => true,
  });
  await controller.setArticle(article);
  assert.equal(starts, 1);
  await controller.setArticle(other);
  await controller.setArticle(article); // restored from storage
  assert.equal(starts, 2); // only "other" started; "article" kept its conversation
});

test('autoStart off (e.g. no API key) waits for the start button', async () => {
  const s = setup();
  await s.controller.setArticle(article);
  assert.ok(!s.log.some((l) => l.startsWith('tutor:')));
});

test('every answered learner turn is reported with its article and whether it was spoken', async () => {
  const reports: string[] = [];
  const controller = createController({
    createSession: () => ({
      history: [],
      start: async () => turn('Q1'),
      send: async (t) => turn('ok', t),
      sendAudio: async () => turn('ok', 'spoken words'),
    }),
    store: { load: async () => null, save: async () => {} },
    recorder: { start: (h) => h.onClip({ mimeType: 'audio/webm', data: 'A' }), stop() {} },
    tts: { speak: async () => {}, stop() {} },
    view: { setPhase() {}, setArticleTitle() {}, clearConversation() {}, addUserMessage() {}, addTutorTurn() {}, showError() {} },
    getRate: () => 1,
    onLearnerTurn: (t, a, spoken) => void reports.push(`${t.transcript}|${a.title}|${spoken}`),
  });
  await controller.setArticle(article);
  await controller.start(); // the tutor's own opening is not a learner turn
  await controller.submitText('typed answer');
  controller.toggleMic();
  await tick();
  assert.deepEqual(reports, ['typed answer|Title|false', 'spoken words|Title|true']);
});
