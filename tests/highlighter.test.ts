import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { highlightTerms } from '../src/content/highlighter.ts';

const root = (html: string) =>
  new JSDOM(`<body><div id="r">${html}</div></body>`).window.document.getElementById('r') as unknown as Element;
const e = (term: string) => ({ term });
const spans = (r: Element) => [...r.querySelectorAll('.veritas-term')].map((s) => s.textContent);

test('wraps single words and phrases, case-insensitively', () => {
  const r = root('<p>An Eloquent speech and a red herring.</p>');
  assert.equal(highlightTerms(r, [e('eloquent'), e('red herring')]), 2);
  assert.deepEqual(spans(r), ['Eloquent', 'red herring']);
  assert.equal((r.querySelector('span') as HTMLElement).dataset.term, 'eloquent');
  assert.equal(r.textContent, 'An Eloquent speech and a red herring.');
});

test('does not match inside larger words', () => {
  const r = root('<p>The caution was uncautious; cautions abound.</p>');
  assert.equal(highlightTerms(r, [e('caution')]), 1);
});

test('prefers the longest term when terms overlap', () => {
  const r = root('<p>He took off quickly.</p>');
  highlightTerms(r, [e('took'), e('took off')]);
  assert.deepEqual(spans(r), ['took off']);
});

test('is idempotent and skips script/code contents', () => {
  const r = root('<p>vivid</p><code>vivid</code><script>var vivid</script>');
  highlightTerms(r, [e('vivid')]);
  assert.equal(highlightTerms(r, [e('vivid')]), 0);
  assert.equal(spans(r).length, 1);
});

test('escapes regex metacharacters in terms', () => {
  const r = root('<p>Use the (so-called) expert, a.k.a. now.</p>');
  assert.equal(highlightTerms(r, [e('a.k.a.')]), 1);
  assert.equal(highlightTerms(r, [e('(so-called)')]), 1);
});

test('keeps surrounding inline markup intact', () => {
  const r = root('<p>A <b>bold</b> and vivid <a href="#">link</a>.</p>');
  highlightTerms(r, [e('vivid')]);
  assert.equal(r.querySelector('a')!.textContent, 'link');
  assert.equal(r.textContent, 'A bold and vivid link.');
});

test('matches typographic apostrophes and dashes and keys spans consistently', () => {
  const r = root('<p>They won’t accept the state‑run plan.</p>');
  assert.equal(highlightTerms(r, [e("won't"), e('state-run')]), 2);
  const keys = [...r.querySelectorAll<HTMLElement>('.veritas-term')].map((s) => s.dataset.term);
  assert.deepEqual(keys, ["won't", 'state-run']);
});

test('a word next to an em dash still matches, but not inside a hyphenated word', () => {
  const r = root('<p>It was vivid—truly. The state‑run vivid‑looking plan.</p>');
  assert.equal(highlightTerms(r, [e('vivid')]), 1);
});
