import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { blockText, createSelectionPopup, isSingleWord, readSelection } from '../src/content/selection.ts';

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

function popup(p: ReturnType<typeof page>) {
  const calls = { translate: [] as [string, string][], pronounce: [] as string[], ipa: [] as string[] };
  const ui = createSelectionPopup(p.doc, {
    translate: async (text, context) => (calls.translate.push([text, context]), `譯:${text}`),
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
