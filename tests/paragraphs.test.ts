import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { attachTranslateButtons } from '../src/content/paragraphs.ts';
import { highlightTerms } from '../src/content/highlighter.ts';

const LONG = 'This paragraph is comfortably longer than forty characters.';
const setup = (html: string) => {
  const { window } = new JSDOM(`<body><div id="r">${html}</div></body>`);
  const root = window.document.getElementById('r') as unknown as Element;
  return { window, root };
};
const click = (window: { MouseEvent: typeof MouseEvent }, el: Element) =>
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const tick = () => new Promise((r) => setImmediate(r));

test('adds a button to long paragraphs only, and only once', () => {
  const { root } = setup(`<p>${LONG}</p><p>Photo: AP</p><p>${LONG}</p>`);
  assert.equal(attachTranslateButtons(root, async () => ''), 2);
  assert.equal(attachTranslateButtons(root, async () => ''), 0);
  assert.equal(root.querySelectorAll('.veritas-tr-btn').length, 2);
});

test('click translates once, shows the result below the paragraph, then toggles', async () => {
  const { window, root } = setup(`<p>${LONG}</p>`);
  let calls = 0;
  attachTranslateButtons(root, async (text) => (calls++, `ZH:${text}`));
  const btn = root.querySelector('.veritas-tr-btn')!;

  click(window, btn);
  const panel = root.querySelector('.veritas-tr-panel') as HTMLElement;
  assert.equal(panel.textContent, '翻譯中…');
  assert.equal(root.querySelector('p')!.nextElementSibling, panel);
  await tick();
  assert.equal(panel.textContent, `ZH:${LONG}`);

  click(window, btn); // hide
  assert.equal(panel.hidden, true);
  click(window, btn); // show again without another request
  assert.equal(panel.hidden, false);
  assert.equal(calls, 1);
});

test('the translated text excludes the button label', async () => {
  const { window, root } = setup(`<p>${LONG}</p>`);
  let sent = '';
  attachTranslateButtons(root, async (t) => ((sent = t), 'x'));
  click(window, root.querySelector('.veritas-tr-btn')!);
  assert.equal(sent, LONG);
});

test('a failed translation shows the error and the next click retries', async () => {
  const { window, root } = setup(`<p>${LONG}</p>`);
  let fail = true;
  attachTranslateButtons(root, async () => {
    if (fail) throw new Error('quota');
    return 'ok';
  });
  const btn = root.querySelector('.veritas-tr-btn')!;
  click(window, btn);
  await tick();
  assert.match(root.querySelector('.veritas-tr-panel')!.textContent!, /quota/);
  fail = false;
  click(window, btn);
  await tick();
  assert.equal(root.querySelector('.veritas-tr-panel')!.textContent, 'ok');
});

test('highlighter ignores the inserted button and panel', async () => {
  const { window, root } = setup(`<p>${LONG}</p>`);
  attachTranslateButtons(root, async () => '譯文 translate');
  click(window, root.querySelector('.veritas-tr-btn')!);
  await tick();
  assert.equal(highlightTerms(root, [{ term: '譯' }, { term: 'translate' }]), 0);
});
