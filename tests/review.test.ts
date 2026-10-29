import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buildReviewSystemPrompt, formatSession, reviewSession, sessionStats } from '../src/lib/review.ts';
import { progressLabel } from '../src/sidepanel/view.ts';
import type { JsonGenerator, JsonRequest } from '../src/lib/gemini.ts';
import type { TutorTurn } from '../src/lib/tutor.ts';

const turn = (o: Partial<TutorTurn> = {}): TutorTurn => ({
  transcript: '', reply: 'r', corrections: [], betterAnswer: '', pronunciation: '', praise: '', hints: [], usedWords: [], ...o,
});
const fix = { original: 'I go', corrected: 'I went', explanation: '' };
const turns = [
  turn({ reply: 'What happened?' }), // the tutor's opening: not an answer
  turn({ transcript: 'a storm hit the coast', spoken: true, usedWords: ['batter'] }),
  turn({ transcript: 'I go there yesterday', corrections: [fix] }),
  turn({ transcript: 'they batter the town', spoken: true, usedWords: ['batter'], corrections: [fix, fix] }),
];
const opts = { level: 'B2', nativeLanguage: 'Traditional Chinese' };

test('sessionStats counts answers, spoken answers, corrections and distinct practice words', () => {
  assert.deepEqual(sessionStats(turns), { answers: 3, spoken: 2, corrections: 3, usedWords: ['batter'] });
});

test('the session is sent as the numbered answers with their corrections', () => {
  const text = formatSession('Storm hits coast', turns);
  assert.match(text, /Article discussed: Storm hits coast/);
  assert.match(text, /1\. \(spoken\) a storm hit the coast/);
  assert.match(text, /2\. I go there yesterday\n {3}corrections:\n {3}- "I go" -> "I went"/);
  assert.doesNotMatch(text, /What happened/);
});

test('prompt asks for feedback in the learner language with a level estimate', () => {
  const p = buildReviewSystemPrompt(opts);
  assert.match(p, /Traditional Chinese/);
  assert.match(p, /"level"/);
});

test('reviewSession returns the AI feedback plus local stats, using the review task', async () => {
  let sent!: JsonRequest;
  const client: JsonGenerator = {
    generateJson: async (r) => (
      (sent = r),
      { overall: ' 很好 ', strengths: ['流暢', ''], focus: ['時態', '冠詞', '介系詞', '多餘'], nextTime: '多用過去式', level: 'B1' }
    ),
  };
  const r = await reviewSession(client, 'Storm', turns, opts);
  assert.equal(sent.task, 'review');
  assert.equal(r.overall, '很好');
  assert.deepEqual(r.strengths, ['流暢']);
  assert.equal(r.focus.length, 3);
  assert.equal(r.stats.answers, 3);
});

test('no answers yet: no request, a clear message instead', async () => {
  let calls = 0;
  const client: JsonGenerator = { generateJson: async () => (calls++, {}) };
  await assert.rejects(reviewSession(client, 'T', [turn({ reply: 'Q?' })], opts), /先回答至少一題/);
  assert.equal(calls, 0);
});

test('an empty AI review is an error', async () => {
  await assert.rejects(reviewSession({ generateJson: async () => ({}) }, 'T', turns, opts), /No review/);
});

test('progressLabel shows today against the goal and the streak', () => {
  assert.equal(progressLabel({ answers: 6, goal: 10, streak: 3 }), '今日 6/10 回答 · 🔥 連續 3 天');
  assert.equal(progressLabel({ answers: 10, goal: 10, streak: 0 }), '✅ 今日目標達成 10/10');
});

test('the review card renders stats, lists and progress as text', async () => {
  const { window } = new JSDOM('<body><div id="log"></div></body>');
  const doc = window.document as unknown as Document;
  const { createView } = await import('../src/sidepanel/view.ts');
  const make = (tag: string) => doc.createElement(tag);
  const parts = {
    title: make('div'), status: make('div'), log: doc.getElementById('log')!, error: make('div'),
    startButton: make('button') as HTMLButtonElement, micButton: make('button') as HTMLButtonElement,
    sendButton: make('button') as HTMLButtonElement, finishButton: make('button') as HTMLButtonElement,
    input: make('input') as HTMLInputElement, progress: make('div'),
  };
  const view = createView(doc, parts, () => {});
  view.addReview({
    overall: '<b>很好</b>', strengths: ['流暢'], focus: ['時態'], nextTime: '多用過去式', level: 'B1',
    stats: { answers: 3, spoken: 2, corrections: 3, usedWords: ['batter'] },
    progress: { answers: 6, goal: 10, streak: 2 },
  });
  const text = parts.log.textContent!;
  for (const s of ['回答 3 次（口說 2）', '糾正 3 處', '口說程度約 B1', '用上了生字：batter', '<b>很好</b>', '時態', '下次試試：多用過去式', '今日 6/10 回答 · 🔥 連續 2 天']) {
    assert.ok(text.includes(s), s);
  }
  assert.equal(parts.log.querySelector('b'), null);
});
