import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRecommendPanel, markPickedLinks } from '../src/content/recommend-ui.ts';
import { collectHeadlines } from '../src/content/headlines.ts';
import type { Recommendation } from '../src/lib/recommend.ts';

const pick = (n: number, extra: Partial<Recommendation> = {}): Recommendation => ({
  url: `https://edition.cnn.com/2026/10/21/story-${n}`,
  title: `Headline number ${n} about something`,
  reason: `理由 ${n}`,
  level: 'B2',
  topic: 'World',
  ...extra,
});
const tick = () => new Promise((r) => setImmediate(r));

function setup(body = '') {
  const { window } = new JSDOM(`<body>${body}</body>`, { url: 'https://edition.cnn.com/' });
  return { window, doc: window.document as unknown as Document };
}

test('opening the panel loads picks once and renders them as safe links', async () => {
  const { doc } = setup();
  let calls = 0;
  const ui = createRecommendPanel(doc, {
    load: async () => (calls++, [pick(1, { title: '<b>x</b> title text here' }), pick(2)]),
  });
  ui.fab.click();
  assert.equal(ui.panel.hidden, false);
  await tick();
  const links = [...ui.panel.querySelectorAll('a')];
  assert.equal(links.length, 2);
  assert.equal(links[0]!.textContent, '<b>x</b> title text here'); // rendered as text, not HTML
  assert.equal(links[1]!.getAttribute('href'), pick(2).url);
  assert.match(ui.panel.textContent!, /理由 2/);
  assert.match(ui.panel.textContent!, /World · B2/);

  ui.fab.click(); // close
  ui.fab.click(); // reopen: no second request
  assert.equal(calls, 1);
});

test('errors are shown and retried on the next open; refresh forces a reload', async () => {
  const { doc } = setup();
  const forced: boolean[] = [];
  let fail = true;
  const ui = createRecommendPanel(doc, {
    load: async (force) => {
      forced.push(force);
      if (fail) throw new Error('免費額度已用完');
      return [pick(1)];
    },
  });
  ui.fab.click();
  await tick();
  assert.match(ui.panel.textContent!, /免費額度已用完/);
  fail = false;
  ui.fab.click();
  ui.fab.click();
  await tick();
  assert.equal(ui.panel.querySelectorAll('a').length, 1);
  (ui.panel.querySelector('.head button') as HTMLButtonElement).click(); // ↻
  await tick();
  assert.deepEqual(forced, [false, false, true]);
});

test('markPickedLinks badges matching story links once, ignoring query strings', () => {
  const { doc } = setup(`
    <a href="/2026/10/21/story-1?ref=home">Headline number 1 about something</a>
    <a href="/2026/10/21/story-1"><img alt=""></a>
    <a href="/2026/10/21/other">Some other story on the page</a>`);
  assert.equal(markPickedLinks(doc, [pick(1)]), 1);
  assert.equal(markPickedLinks(doc, [pick(1)]), 0);
  const badge = doc.querySelector('.veritas-pick')!;
  assert.equal((badge as HTMLElement).title, '理由 1');
});

test('headline collection ignores the badge text added by Veritas', () => {
  const { doc } = setup('<a href="/2026/10/21/story-1">Headline number 1 about something</a>');
  markPickedLinks(doc, [pick(1)]);
  assert.equal(collectHeadlines(doc)[0]!.title, 'Headline number 1 about something');
});
