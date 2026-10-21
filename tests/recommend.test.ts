import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRecommendSystemPrompt,
  formatHeadlines,
  normalizePicks,
  recommendHeadlines,
} from '../src/lib/recommend.ts';
import type { JsonGenerator, JsonRequest } from '../src/lib/gemini.ts';

const headlines = ['Storm hits the coast', 'Markets fall sharply', 'New vaccine trial', 'Quiz of the week'].map(
  (title, i) => ({ url: `https://cnn.com/2026/a${i}`, title }),
);
const opts = { level: 'B2', nativeLanguage: 'Traditional Chinese', interests: 'science' };

test('prompt carries level, language and interests; empty interests fall back', () => {
  const p = buildRecommendSystemPrompt(opts);
  for (const s of ['B2', 'Traditional Chinese', 'science']) assert.ok(p.includes(s), s);
  assert.match(buildRecommendSystemPrompt({ ...opts, interests: '' }), /did not list interests/);
});

test('headlines are numbered from 1', () => {
  assert.equal(formatHeadlines(headlines.slice(0, 2)), '1. Storm hits the coast\n2. Markets fall sharply');
});

test('picks are mapped back to real headlines by number; unknown ids and duplicates are dropped', () => {
  const picks = normalizePicks(
    { picks: [{ id: 3, reason: ' 重要 ', level: 'B2', topic: 'Health' }, { id: 99 }, { id: 3 }, { id: '1' }, null] },
    headlines,
  );
  assert.deepEqual(picks.map((p) => p.title), ['New vaccine trial', 'Storm hits the coast']);
  assert.equal(picks[0]!.url, 'https://cnn.com/2026/a2');
  assert.equal(picks[0]!.reason, '重要');
});

test('at most five picks', () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ url: `u${i}`, title: `t${i}` }));
  const raw = { picks: many.map((_, i) => ({ id: i + 1 })) };
  assert.equal(normalizePicks(raw, many).length, 5);
});

test('recommendHeadlines sends the numbered list and fails when nothing usable comes back', async () => {
  let sent!: JsonRequest;
  const client: JsonGenerator = { generateJson: async (r) => ((sent = r), { picks: [{ id: 2 }] }) };
  const picks = await recommendHeadlines(client, headlines, opts);
  assert.equal(picks[0]!.title, 'Markets fall sharply');
  assert.match(sent.messages[0]!.text, /^1\. Storm hits the coast/);
  await assert.rejects(recommendHeadlines({ generateJson: async () => ({ picks: [] }) }, headlines, opts), /did not recommend/);
});

test('long front pages are trimmed before being sent', async () => {
  let sent!: JsonRequest;
  const many = Array.from({ length: 200 }, (_, i) => ({ url: `u${i}`, title: `t${i}` }));
  await recommendHeadlines({ generateJson: async (r) => ((sent = r), { picks: [{ id: 1 }] }) }, many, opts);
  assert.equal(sent.messages[0]!.text.split('\n').length, 80);
});
