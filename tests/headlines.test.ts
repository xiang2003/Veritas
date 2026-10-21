import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { collectHeadlines } from '../src/content/headlines.ts';

const page = (body: string, url = 'https://edition.cnn.com/') =>
  new JSDOM(`<body>${body}</body>`, { url }).window.document as unknown as Document;

test('collects article links with headline-like text, resolved to absolute URLs', () => {
  const doc = page(`
    <a href="/2026/10/21/world/storm-coast/index.html">Powerful storm batters the coast overnight</a>
    <a href="https://edition.cnn.com/2026/10/21/business/markets?utm=x#top">Markets fall sharply after rate decision</a>`);
  assert.deepEqual(collectHeadlines(doc), [
    { url: 'https://edition.cnn.com/2026/10/21/world/storm-coast/index.html', title: 'Powerful storm batters the coast overnight' },
    { url: 'https://edition.cnn.com/2026/10/21/business/markets', title: 'Markets fall sharply after rate decision' },
  ]);
});

test('skips navigation, short labels, other sites, videos and the page itself', () => {
  const doc = page(`
    <nav><a href="/2026/10/21/world/nav-story">A story linked from the menu bar</a></nav>
    <a href="/world">World</a>
    <a href="/2026/10/21/x">Too short</a>
    <a href="https://other.com/2026/10/21/story">A story hosted on another website entirely</a>
    <a href="/videos/2026/10/21/clip">Watch the dramatic moment it happened</a>
    <a href="mailto:x@y.z">Send us an email about this story please</a>
    <a href="/">Back to the CNN home page right now</a>`);
  assert.deepEqual(collectHeadlines(doc), []);
});

test('the same story linked twice keeps one entry with the longer text', () => {
  const doc = page(`
    <a href="/2026/10/21/a"><img alt="">Storm hits the coast</a>
    <a href="/2026/10/21/a">Storm hits the coast as thousands evacuate</a>`);
  const out = collectHeadlines(doc);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.title, 'Storm hits the coast as thousands evacuate');
});

test('subdomains of the same site count as the same site', () => {
  const doc = page('<a href="https://www.bbc.com/news/articles/c4g0kq1lw9yo">Scientists find water ice on a distant moon</a>', 'https://bbc.com/news');
  assert.equal(collectHeadlines(doc).length, 1);
});
