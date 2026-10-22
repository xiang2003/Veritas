import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { showToast } from '../src/content/toast.ts';

const doc = () => new JSDOM('<body></body>').window.document as unknown as Document;
const text = (d: Document) => (d.body.lastElementChild as HTMLElement | null)?.shadowRoot?.textContent ?? '';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('a persistent toast stays until closed and can be updated', async () => {
  const d = doc();
  const t = showToast(d, '正在分析…', { persist: true });
  assert.match(text(d), /正在分析/);
  t.update('已標出 12 個生字');
  assert.match(text(d), /已標出 12 個生字/);
  t.close(10);
  await wait(30);
  assert.equal(d.body.children.length, 0);
});

test('toasts are marked as Veritas UI so other passes ignore them', () => {
  const d = doc();
  showToast(d, 'x', { persist: true });
  assert.equal(d.body.lastElementChild!.className, 'veritas-ui');
});
