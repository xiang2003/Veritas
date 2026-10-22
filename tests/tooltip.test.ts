import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { computePosition } from '../src/content/tooltip-position.ts';
import { renderEntry, createTooltip } from '../src/content/tooltip.ts';
import type { VocabEntry } from '../src/lib/types.ts';

const vp = { width: 1000, height: 800 };
const size = { width: 300, height: 150 };

test('places tooltip below anchor by default', () => {
  assert.deepEqual(computePosition({ top: 100, bottom: 120, left: 50 }, size, vp), { top: 128, left: 50 });
});

test('flips above when there is no room below', () => {
  assert.equal(computePosition({ top: 700, bottom: 720, left: 50 }, size, vp).top, 542);
});

test('clamps horizontally into viewport', () => {
  assert.equal(computePosition({ top: 0, bottom: 10, left: 900 }, size, vp).left, 692);
  assert.equal(computePosition({ top: 0, bottom: 10, left: -40 }, size, vp).left, 8);
});

const entry: VocabEntry = {
  term: 'eloquent', lemma: 'eloquent', ipa: '/x/', pos: 'adj', meaning: '雄辯的',
  definition: 'fluent', example: 'An eloquent plea.', usage: '多用於演說',
};
const newDoc = () => new JSDOM('<body></body>').window.document as unknown as Document;

test('renderEntry shows fields as text, never as HTML', () => {
  const doc = newDoc();
  const box = doc.createElement('div');
  box.append(renderEntry(doc, { ...entry, meaning: '<img src=x onerror=alert(1)>' }, () => {}));
  assert.equal(box.querySelector('img'), null);
  assert.match(box.textContent!, /<img src=x/);
});

test('speak button reports the entry', () => {
  const doc = newDoc();
  let spoken = '';
  const box = doc.createElement('div');
  box.append(renderEntry(doc, entry, (e) => (spoken = e.term)));
  box.querySelector('button')!.click();
  assert.equal(spoken, 'eloquent');
});

test('hovering a term shows its card; unknown terms show nothing', () => {
  const { window } = new JSDOM(
    '<body><p><span class="veritas-term" data-term="eloquent">Eloquent</span><span class="veritas-term" data-term="zzz">zzz</span></p></body>',
  );
  const document = window.document as unknown as Document;
  const tip = createTooltip(document, { lookup: (t) => (t === 'eloquent' ? entry : undefined), speak() {} });
  const [known, unknown] = document.querySelectorAll('.veritas-term');
  unknown!.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
  assert.equal(tip.card.style.display, '');
  known!.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
  assert.equal(tip.card.style.display, 'block');
  assert.match(tip.card.textContent!, /雄辯的/);
});

test('card links to the Cambridge entry of the dictionary form', () => {
  const doc = newDoc();
  const box = doc.createElement('div');
  box.append(renderEntry(doc, { ...entry, term: 'red herrings', lemma: 'red herring' }, () => {}));
  const link = box.querySelector('a')!;
  assert.equal(link.href, 'https://dictionary.cambridge.org/dictionary/english/red-herring');
  assert.equal(link.target, '_blank');
});

test('dictionary IPA replaces the AI estimate when it arrives for the card still shown', async () => {
  const { window } = new JSDOM('<body><span class="veritas-term" data-term="eloquent">Eloquent</span></body>');
  const document = window.document as unknown as Document;
  const tip = createTooltip(document, { lookup: () => entry, speak() {}, fetchIpa: async () => '/ˈɛləkwənt/' });
  document.querySelector('.veritas-term')!.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
  assert.equal(tip.card.querySelector('.ipa')!.textContent, '/x/');
  await new Promise((r) => setImmediate(r));
  assert.equal(tip.card.querySelector('.ipa')!.textContent, '/ˈɛləkwənt/');
});

function hoverSetup(dwellMs = 20) {
  const { window } = new JSDOM('<body><p><span class="veritas-term" data-term="eloquent">Eloquent</span> words.</p></body>');
  const document = window.document as unknown as Document;
  const lookups: string[] = [];
  const tip = createTooltip(document, {
    lookup: () => entry,
    speak() {},
    onLookup: (e) => void lookups.push(e.term),
    dwellMs,
  });
  const span = document.querySelector('.veritas-term')!;
  const over = () => span.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
  const out = () => span.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true }));
  return { tip, lookups, over, out };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('reading a card for the dwell time counts as a lookup', async () => {
  const s = hoverSetup();
  s.over();
  await wait(40);
  assert.deepEqual(s.lookups, ['eloquent']);
});

test('just passing the mouse over a word is not a lookup', async () => {
  const s = hoverSetup(300); // longer than the 150ms hide delay
  s.over();
  s.out();
  await wait(400);
  assert.equal(s.tip.card.style.display, 'none');
  assert.deepEqual(s.lookups, []);
});

test('playing the pronunciation counts as a lookup right away', () => {
  const s = hoverSetup(10_000);
  s.over();
  (s.tip.card.querySelector('button') as HTMLButtonElement).click();
  assert.deepEqual(s.lookups, ['eloquent']);
});
