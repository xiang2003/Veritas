import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { showTutorButton } from '../src/content/auto-open.ts';

const tick = () => new Promise((r) => setImmediate(r));

function setup(open: () => Promise<boolean>) {
  const { window } = new JSDOM('<body><p>Article text</p></body>');
  const doc = window.document as unknown as Document;
  const host = showTutorButton(doc, open);
  return { doc, host, button: host.shadowRoot!.querySelector('button')! };
}

test('the button is shown on load and opens nothing by itself', () => {
  let opens = 0;
  const { host, button } = setup(async () => (opens++, true));
  assert.ok(host.isConnected);
  assert.equal(button.textContent, '💬 AI 教練');
  assert.equal(opens, 0);
});

test('clicking it opens the tutor and the button stays for later', async () => {
  let opens = 0;
  const { host, button } = setup(async () => (opens++, true));
  button.click();
  await tick();
  button.click();
  await tick();
  assert.equal(opens, 2);
  assert.ok(host.isConnected);
});

test('if Chrome refuses, the button points to the toolbar icon', async () => {
  const { button } = setup(async () => false);
  button.click();
  await tick();
  assert.match(button.textContent!, /Veritas 圖示/);
});

test('an error while opening is treated like a refusal', async () => {
  const { button } = setup(async () => {
    throw new Error('may only be called in response to a user gesture');
  });
  button.click();
  await tick();
  assert.match(button.textContent!, /Veritas 圖示/);
});

test('the button is marked as Veritas UI so other passes ignore it', () => {
  const { host } = setup(async () => true);
  assert.equal(host.className, 'veritas-ui');
});
