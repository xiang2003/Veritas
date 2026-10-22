import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buildSummarySystemPrompt, normalizeSummary, summarizeArticle, type ArticleSummary } from '../src/lib/summary.ts';
import { createSummarySection } from '../src/content/summary-ui.ts';
import { readSelection } from '../src/content/selection.ts';
import { createHandlers } from '../src/background/handlers.ts';
import { DEFAULT_SETTINGS, type StorageLike } from '../src/lib/settings.ts';
import type { JsonGenerator, JsonRequest } from '../src/lib/gemini.ts';

const article = { url: 'https://cnn.com/a', title: 'Storm hits coast', text: 'A powerful storm hit the coast.' };
const opts = { level: 'B2', nativeLanguage: 'Traditional Chinese' };
const good: ArticleSummary = {
  gist: 'A storm hit the coast and forced evacuations.',
  points: ['Thousands left their homes.', 'Power was cut in many towns.'],
  translation: '一場風暴襲擊海岸，數千人撤離。',
};
const tick = () => new Promise((r) => setImmediate(r));

test('prompt targets the learner level, forbids added facts and asks for the native-language summary', () => {
  const p = buildSummarySystemPrompt(opts);
  assert.match(p, /B2/);
  assert.match(p, /add no facts/);
  assert.match(p, /Traditional Chinese/);
});

test('normalizeSummary trims, drops empty points, keeps at most five, and rejects empty results', () => {
  const s = normalizeSummary({ gist: ' G ', points: [' a ', '', 1, 'b', 'c', 'd', 'e', 'f'], translation: ' 中 ' });
  assert.deepEqual(s, { gist: 'G', points: ['a', 'b', 'c', 'd', 'e'], translation: '中' });
  assert.throws(() => normalizeSummary({ translation: 'only' }), /No summary/);
  assert.throws(() => normalizeSummary(null), /No summary/);
});

test('summarizeArticle sends the article as a summarize task', async () => {
  let sent!: JsonRequest;
  const client: JsonGenerator = { generateJson: async (r) => ((sent = r), good) };
  assert.deepEqual(await summarizeArticle(client, article, opts), good);
  assert.equal(sent.task, 'summarize');
  assert.match(sent.messages[0]!.text, /Title: Storm hits coast/);
});

function memory(): StorageLike {
  const data: Record<string, unknown> = {};
  return {
    get: async (keys) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]])),
    set: async (items) => void Object.assign(data, items),
  };
}

test('background caches the summary per article and redoes it when the level changes', async () => {
  let calls = 0;
  const settings = { ...DEFAULT_SETTINGS, apiKey: 'k' };
  const handlers = createHandlers({
    client: { generateJson: async () => (calls++, good) },
    getSettings: async () => settings,
    cache: memory(),
    session: memory(),
  });
  const ask = () => handlers.handle({ type: 'summarize', article });
  assert.deepEqual(await ask(), { ok: true, summary: good });
  await ask();
  assert.equal(calls, 1);
  settings.level = 'C1';
  await ask();
  assert.equal(calls, 2);
});

function page() {
  const { window } = new JSDOM('<body><main><article id="a"><p>Story text.</p></article><footer>Site footer</footer></main></body>');
  const doc = window.document as unknown as Document;
  return { doc, root: doc.getElementById('a')! };
}

test('the section sits right after the article and loads nothing until asked', () => {
  const { root } = page();
  let calls = 0;
  const { section } = createSummarySection(root, { load: async () => (calls++, good), speak: async () => {}, stop() {} });
  assert.equal(root.nextElementSibling, section);
  assert.equal(calls, 0);
});

test('generating shows gist and points, with the Chinese summary hidden until toggled', async () => {
  const { root } = page();
  const { section } = createSummarySection(root, { load: async () => good, speak: async () => {}, stop() {} });
  section.querySelector('button')!.click();
  await tick();
  assert.match(section.textContent!, /A storm hit the coast/);
  assert.equal(section.querySelectorAll('li').length, 2);
  const translation = section.querySelector<HTMLElement>('.veritas-summary-translation')!;
  assert.equal(translation.hidden, true);
  const toggle = [...section.querySelectorAll('button')].find((b) => b.textContent === '顯示中文')!;
  toggle.click();
  assert.equal(translation.hidden, false);
  assert.equal(toggle.textContent, '隱藏中文');
});

test('read-aloud speaks the English summary and the second click stops it', async () => {
  const { root } = page();
  const spoken: string[] = [];
  let stops = 0;
  const { section } = createSummarySection(root, {
    load: async () => good,
    speak: (t) => (spoken.push(t), new Promise(() => {})),
    stop: () => stops++,
  });
  section.querySelector('button')!.click();
  await tick();
  const listen = [...section.querySelectorAll('button')].find((b) => b.textContent === '🔊 朗讀')!;
  listen.click();
  assert.deepEqual(spoken, [`${good.gist} ${good.points.join(' ')}`]);
  assert.equal(listen.textContent, '⏹ 停止');
  listen.click();
  assert.equal(stops, 1);
});

test('errors are shown and the button retries', async () => {
  const { root } = page();
  let fail = true;
  const { section } = createSummarySection(root, {
    load: async () => {
      if (fail) throw new Error('免費額度已用完');
      return good;
    },
    speak: async () => {},
    stop() {},
  });
  const button = section.querySelector('button')!;
  button.click();
  await tick();
  assert.match(section.textContent!, /免費額度已用完/);
  assert.equal(button.textContent, '再試一次');
  fail = false;
  button.click();
  await tick();
  assert.equal(section.querySelectorAll('li').length, 2);
});

test('attach() puts the section back after a re-render removed it', () => {
  const { root } = page();
  const s = createSummarySection(root, { load: async () => good, speak: async () => {}, stop() {} });
  s.section.remove();
  s.attach();
  assert.equal(root.nextElementSibling, s.section);
});

test('summary sentences can be selected for the selection toolbar', async () => {
  const { doc, root } = page();
  const { section } = createSummarySection(root, { load: async () => good, speak: async () => {}, stop() {} });
  section.querySelector('button')!.click();
  await tick();
  const li = section.querySelector('li')!;
  const range = doc.createRange();
  range.selectNodeContents(li.firstChild!);
  doc.getSelection()!.addRange(range);
  assert.equal(readSelection(doc.getSelection())!.text, 'Thousands left their homes.');
});
