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

test('speak button reports the term', () => {
  const doc = newDoc();
  let spoken = '';
  const box = doc.createElement('div');
  box.append(renderEntry(doc, entry, (t) => (spoken = t)));
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
