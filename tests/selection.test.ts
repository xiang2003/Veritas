import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { blockText, createSelectionPopup, isShortTerm, isSingleWord, readSelection } from '../src/content/selection.ts';
import type { VocabEntry } from '../src/lib/types.ts';

const PARA = 'The minister was accused of spreading a red herring about the budget.';
const tick = () => new Promise((r) => setTimeout(r, 0));

function page(body = `<p id="p">${PARA}</p>`) {
  const { window } = new JSDOM(`<body>${body}</body>`);
  const doc = window.document as unknown as Document;
  /** Select `needle` inside the element with id `id`. */
  const select = (needle: string, id = 'p') => {
    const textNode = doc.getElementById(id)!.firstChild!;
    const start = textNode.textContent!.indexOf(needle);
    const range = doc.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + needle.length);
    const sel = doc.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  };
  const mouseup = () => doc.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
  return { window, doc, select, mouseup };
}

test('isSingleWord accepts words with apostrophes or hyphens only', () => {
  assert.ok(isSingleWord('herring'));
  assert.ok(isSingleWord("state-run"));
  assert.ok(!isSingleWord('red herring'));
  assert.ok(!isSingleWord('42'));
});

test('readSelection returns the text and its paragraph as context', () => {
  const p = page();
  p.select('red herring');
  const s = readSelection(p.doc.getSelection())!;
  assert.equal(s.text, 'red herring');
  assert.equal(s.context, PARA);
});

test('readSelection ignores empty, non-English, overlong and Veritas UI selections', () => {
  assert.equal(readSelection(page().doc.getSelection()), null);

  const zh = page('<p id="p">這是中文內容</p>');
  zh.select('中文');
  assert.equal(readSelection(zh.doc.getSelection()), null);

  const long = page(`<p id="p">${'word '.repeat(300)}</p>`);
  long.select('word '.repeat(250).trim());
  assert.equal(readSelection(long.doc.getSelection()), null);

  const ui = page('<div class="veritas-ui"><p id="p">Translated helper text here</p></div>');
  ui.select('helper');
  assert.equal(readSelection(ui.doc.getSelection()), null);
});

test('blockText drops Veritas buttons from the context', () => {
  const p = page(`<p id="p"><span class="veritas-ui">🔊譯</span>${PARA}</p>`);
  assert.equal(blockText(p.doc.getElementById('p')!), PARA);
});

const card = (term: string): VocabEntry => ({
  term, lemma: term, pos: 'idiom', ipa: '/rɛd ˈhɛrɪŋ/', definition: 'a distraction', meaning: '轉移注意力的事物',
  example: 'That clue was a red herring.', usage: '常用於推理、政治',
});

function popup(p: ReturnType<typeof page>, defineImpl?: (t: string, c: string) => Promise<VocabEntry>) {
  const calls = { translate: [] as [string, string][], pronounce: [] as string[], ipa: [] as string[], defined: [] as string[] };
  const ui = createSelectionPopup(p.doc, {
    translate: async (text, context) => (calls.translate.push([text, context]), `譯:${text}`),
    define: defineImpl ?? (async (text) => card(text)),
    onDefined: (entry) => void calls.defined.push(entry.term),
    pronounce: async (text) => void calls.pronounce.push(text),
    ipaOf: async (word) => (calls.ipa.push(word), '/ˈhɛrɪŋ/'),
  });
  const button = (cls: string) => ui.card.querySelector<HTMLElement>(`.${cls}`)!;
  return { ui, calls, button };
}

test('selecting text shows the toolbar; translate sends the selection with its paragraph', async () => {
  const p = page();
  const { ui, calls, button } = popup(p);
  p.select('red herring');
  p.mouseup();
  await tick();
  assert.equal(ui.card.style.display, 'block');
  assert.deepEqual(calls.ipa, []); // phrases have no dictionary IPA lookup

  button('tr').click();
  await tick();
  assert.deepEqual(calls.translate, [['red herring', PARA]]);
  assert.equal(ui.card.querySelector('.out')!.textContent, '譯:red herring');

  button('speak').click();
  assert.deepEqual(calls.pronounce, ['red herring']);
});

test('a single word also shows its dictionary IPA', async () => {
  const p = page();
  const { ui } = popup(p);
  p.select('herring');
  p.mouseup();
  await tick();
  await tick();
  assert.equal(ui.card.querySelector('.ipa')!.textContent, '/ˈhɛrɪŋ/');
});

test('clearing the selection or pressing Escape hides the toolbar', async () => {
  const p = page();
  const { ui } = popup(p);
  p.select('budget');
  p.mouseup();
  await tick();
  p.doc.getSelection()!.removeAllRanges();
  p.mouseup();
  await tick();
  assert.equal(ui.card.style.display, 'none');

  p.select('budget');
  p.mouseup();
  await tick();
  p.doc.dispatchEvent(new p.window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(ui.card.style.display, 'none');
});

test('isShortTerm allows words and phrases up to four words', () => {
  assert.ok(isShortTerm('herring'));
  assert.ok(isShortTerm('red herring'));
  assert.ok(!isShortTerm('a b c d e'));
  assert.ok(!isShortTerm('budget, 2026'));
});

test('解釋 shows a full card for a short selection and reports it for underlining', async () => {
  const p = page();
  const { ui, calls, button } = popup(p);
  p.select('red herring');
  p.mouseup();
  await tick();
  assert.equal(button('def').hidden, false);
  button('def').click();
  await tick();
  const out = ui.card.querySelector('.out')!;
  assert.match(out.textContent!, /轉移注意力的事物/);
  assert.match(out.textContent!, /常用於推理/);
  assert.equal(out.querySelector('a')!.getAttribute('href'), 'https://dictionary.cambridge.org/dictionary/english/red-herring');
  assert.deepEqual(calls.defined, ['red herring']);
});

test('解釋 is hidden for long selections and shows errors', async () => {
  const p = page();
  const { ui, button } = popup(p, async () => {
    throw new Error('免費額度已用完');
  });
  p.select('accused of spreading a red herring');
  p.mouseup();
  await tick();
  assert.equal(button('def').hidden, true);

  p.select('herring');
  p.mouseup();
  await tick();
  button('def').click();
  await tick();
  assert.match(ui.card.querySelector('.out')!.textContent!, /免費額度已用完/);
});

test('explaining or translating a short term reports it with its passage', async () => {
  const p = page();
  const reports: string[] = [];
  const ui = createSelectionPopup(p.doc, {
    translate: async () => '轉移焦點',
    define: async (text) => card(text),
    onDefined: (entry, context) => void reports.push(`define:${entry.term}|${context}`),
    onTranslated: (text, translation, context) => void reports.push(`translate:${text}=${translation}|${context}`),
    pronounce: async () => {},
    ipaOf: async () => undefined,
  });
  p.select('red herring');
  p.mouseup();
  await tick();
  ui.card.querySelector<HTMLElement>('.tr')!.click();
  await tick();
  ui.card.querySelector<HTMLElement>('.def')!.click();
  await tick();
  assert.deepEqual(reports, [`translate:red herring=轉移焦點|${PARA}`, `define:red herring|${PARA}`]);

  reports.length = 0;
  p.select('accused of spreading a red herring'); // too long to be a vocabulary lookup
  p.mouseup();
  await tick();
  ui.card.querySelector<HTMLElement>('.tr')!.click();
  await tick();
  assert.deepEqual(reports, []);
});
