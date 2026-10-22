import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isNewsUrl, matchPatternToRegExp } from '../src/lib/site-match.ts';

const manifest = JSON.parse(readFileSync(new URL('../static/manifest.json', import.meta.url), 'utf8'));
const NEWS = manifest.content_scripts.flatMap((c: { matches: string[] }) => c.matches) as string[];

test('subdomain wildcard patterns match the bare domain and any subdomain', () => {
  const re = matchPatternToRegExp('https://*.cnn.com/*');
  assert.ok(re.test('https://cnn.com/2026/10/21/world/a'));
  assert.ok(re.test('https://edition.cnn.com/'));
  assert.ok(!re.test('https://notcnn.com/'));
  assert.ok(!re.test('https://cnn.com.evil.io/'));
  assert.ok(!re.test('http://edition.cnn.com/')); // scheme must match
});

test('exact host patterns do not match other subdomains', () => {
  const re = matchPatternToRegExp('https://apnews.com/*');
  assert.ok(re.test('https://apnews.com/article/x'));
  assert.ok(!re.test('https://www.apnews.com/article/x'));
});

test('invalid patterns are rejected', () => {
  assert.throws(() => matchPatternToRegExp('cnn.com'), /Invalid match pattern/);
});

test('the side panel is enabled exactly on the manifest news sites', () => {
  assert.ok(isNewsUrl('https://edition.cnn.com/2026/10/21/world/storm/index.html', NEWS));
  assert.ok(isNewsUrl('https://www.bbc.com/news/articles/abc', NEWS));
  assert.ok(isNewsUrl('https://time.com/123/story/', NEWS));
  assert.ok(!isNewsUrl('https://www.google.com/search?q=news', NEWS));
  assert.ok(!isNewsUrl('chrome://newtab/', NEWS));
  assert.ok(!isNewsUrl(undefined, NEWS));
});
