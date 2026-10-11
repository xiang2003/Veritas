import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { extractArticle } from '../src/content/extract.js';

const para = (n) => `<p>${`Sentence number ${n} is reasonably long to count. `.repeat(4)}</p>`;
const page = (body, title = 'Tab title') =>
  new JSDOM(`<title>${title}</title><body>${body}</body>`, { url: 'https://cnn.com/a' }).window.document;

test('extracts text from an <article> with enough paragraphs', () => {
  const doc = page(`<h1>Big news</h1><article>${[1, 2, 3, 4].map(para).join('')}</article>`);
  const a = extractArticle(doc);
  assert.equal(a.title, 'Big news');
  assert.equal(a.url, 'https://cnn.com/a');
  assert.equal(a.text.split('\n').length, 4);
  assert.equal(a.root.tagName, 'ARTICLE');
});

test('prefers site-specific container over generic ones', () => {
  const doc = page(`<main><div class="article__content">${[1, 2, 3, 4].map(para).join('')}</div></main>`);
  assert.equal(extractArticle(doc).root.className, 'article__content');
});

test('returns null for pages that are not articles', () => {
  assert.equal(extractArticle(page('<article><p>short</p></article>')), null);
});

test('falls back to document title when no <h1>', () => {
  const doc = page(`<article>${[1, 2, 3, 4].map(para).join('')}</article>`, 'Fallback');
  assert.equal(extractArticle(doc).title, 'Fallback');
});
