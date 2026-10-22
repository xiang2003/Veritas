import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { installAutoOpen } from '../src/content/auto-open.ts';

const tick = () => new Promise((r) => setImmediate(r));

function page() {
  const { window } = new JSDOM('<body><p id="p">Article text</p><div class="veritas-ui"><button id="ui">譯</button></div></body>');
  const doc = window.document as unknown as Document;
  const click = (id: string) => doc.getElementById(id)!.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  return { window, doc, click };
}

test('the first click on the article opens the panel, once', async () => {
  const { doc, click } = page();
  let opens = 0;
  installAutoOpen(doc, async () => (opens++, true));
  click('p');
  click('p');
  await tick();
  assert.equal(opens, 1);
});

test('a key press also counts as the gesture', async () => {
  const { window, doc } = page();
  let opens = 0;
  installAutoOpen(doc, async () => (opens++, true));
  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'j' }));
  await tick();
  assert.equal(opens, 1);
});

test('clicks on Veritas controls do not trigger it', async () => {
  const { doc, click } = page();
  let opens = 0;
  installAutoOpen(doc, async () => (opens++, true));
  click('ui');
  await tick();
  assert.equal(opens, 0);
});

test('if Chrome refuses, an open button appears and works on click', async () => {
  const { doc, click } = page();
  let allow = false;
  installAutoOpen(doc, async () => allow);
  click('p');
  await tick();
  const host = [...doc.body.children].at(-1) as HTMLElement;
  const button = host.shadowRoot!.querySelector('button')!;
  assert.match(button.textContent!, /開啟 AI 教練/);
  allow = true;
  button.click();
  await tick();
  assert.equal(host.isConnected, false);
});
