import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { DEFAULT_SETTINGS } from '../src/lib/settings.ts';

// form.ts uses HTMLInputElement for instanceof checks, so expose jsdom's globals first.
const { window } = new JSDOM(`<form id="f">
  <input name="apiKey"><input name="model"><select name="level"><option>B2</option><option>C1</option></select>
  <input name="nativeLanguage"><input name="speechRate"><input name="autoHighlight" type="checkbox">
</form>`);
Object.assign(globalThis, { HTMLInputElement: window.HTMLInputElement });
const { fillForm, readForm } = await import('../src/options/form.ts');
const form = window.document.getElementById('f') as unknown as HTMLFormElement;

test('fillForm writes settings into controls', () => {
  fillForm(form, { ...DEFAULT_SETTINGS, apiKey: 'K', level: 'C1', autoHighlight: false });
  const el = (n: string) => form.elements.namedItem(n) as HTMLInputElement;
  assert.equal(el('apiKey').value, 'K');
  assert.equal(el('level').value, 'C1');
  assert.equal(el('autoHighlight').checked, false);
  assert.equal(el('speechRate').value, String(DEFAULT_SETTINGS.speechRate));
});

test('readForm trims, types and clamps values', () => {
  const el = (n: string) => form.elements.namedItem(n) as HTMLInputElement;
  el('apiKey').value = '  secret ';
  el('speechRate').value = '9';
  el('autoHighlight').checked = true;
  const patch = readForm(form);
  assert.equal(patch.apiKey, 'secret');
  assert.equal(patch.speechRate, 2);
  assert.equal(patch.autoHighlight, true);
});

test('readForm leaves blank optional fields undefined so defaults survive', () => {
  const el = (n: string) => form.elements.namedItem(n) as HTMLInputElement;
  el('model').value = '';
  el('speechRate').value = 'abc';
  const patch = readForm(form);
  assert.equal(patch.model, undefined);
  assert.equal(patch.speechRate, undefined);
});
