import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProgress, dayKey, summarizeProgress, type ProgressLog } from '../src/lib/progress.ts';
import { createHandlers } from '../src/background/handlers.ts';
import { DEFAULT_SETTINGS, type StorageLike } from '../src/lib/settings.ts';

function memory(): StorageLike & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (keys) => structuredClone(Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]))),
    set: async (items) => void Object.assign(data, structuredClone(items)),
  };
}

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const day = (answers: number) => ({ answers, spokenAnswers: 0, lookups: 0, reviews: 0 });

test('dayKey uses the local calendar day', () => {
  assert.equal(dayKey(at(2026, 3, 5, 0)), '2026-03-05');
  assert.equal(dayKey(at(2026, 3, 5, 23)), '2026-03-05');
});

test('track adds to today, per field, across calls', async () => {
  let now = at(2026, 10, 29, 9);
  const p = createProgress(memory(), () => now);
  await p.track({ answers: 1, spokenAnswers: 1 });
  await p.track({ answers: 1 });
  await p.track({ lookups: 3 });
  now = at(2026, 10, 30, 9);
  await p.track({ answers: 1 });
  const log = await p.read();
  assert.deepEqual(log['2026-10-29'], { answers: 2, spokenAnswers: 1, lookups: 3, reviews: 0 });
  assert.equal(log['2026-10-30']!.answers, 1);
});

test('simultaneous updates are all counted', async () => {
  const p = createProgress(memory(), () => at(2026, 10, 29));
  await Promise.all(Array.from({ length: 10 }, () => p.track({ answers: 1 })));
  assert.equal((await p.read())['2026-10-29']!.answers, 10);
});

test('streak counts consecutive days that met the goal, ending today', () => {
  const log: ProgressLog = { '2026-10-27': day(10), '2026-10-28': day(12), '2026-10-29': day(10) };
  const s = summarizeProgress(log, 10, at(2026, 10, 29));
  assert.equal(s.streak, 3);
  assert.equal(s.goalMet, true);
});

test('while today is not done yet, the streak up to yesterday is kept', () => {
  const log: ProgressLog = { '2026-10-27': day(10), '2026-10-28': day(10), '2026-10-29': day(4) };
  const s = summarizeProgress(log, 10, at(2026, 10, 29));
  assert.equal(s.streak, 2);
  assert.equal(s.goalMet, false);
  assert.equal(s.today.answers, 4);
});

test('a missed day breaks the streak; an empty log has none', () => {
  const log: ProgressLog = { '2026-10-26': day(10), '2026-10-28': day(10) };
  assert.equal(summarizeProgress(log, 10, at(2026, 10, 29)).streak, 1);
  assert.equal(summarizeProgress({}, 10, at(2026, 10, 29)).streak, 0);
  assert.deepEqual(summarizeProgress({}, 10, at(2026, 10, 29)).today, day(0));
});

test('streaks run across month ends', () => {
  const log: ProgressLog = { '2026-02-28': day(5), '2026-03-01': day(5) };
  assert.equal(summarizeProgress(log, 5, at(2026, 3, 1)).streak, 2);
});

test('background tracks progress messages and counts counted lookups', async () => {
  const cache = memory();
  const handlers = createHandlers({
    client: { generateJson: async () => ({}) },
    getSettings: async () => ({ ...DEFAULT_SETTINGS, apiKey: 'k' }),
    cache,
    session: memory(),
    now: () => at(2026, 10, 29),
  });
  await handlers.handle({ type: 'track-progress', delta: { answers: 1, spokenAnswers: 1 } });
  const entry = { term: 'quell', lemma: 'quell', pos: '', ipa: '', meaning: '', definition: '', example: '', usage: '' };
  const context = { url: 'u', title: '', sentence: '' };
  await handlers.handle({ type: 'record-lookup', entry, context });
  await handlers.handle({ type: 'record-lookup', entry, context, count: false }); // same page again: not counted
  const log = cache.data['progress'] as ProgressLog;
  assert.deepEqual(log['2026-10-29'], { answers: 1, spokenAnswers: 1, lookups: 1, reviews: 0 });
});
