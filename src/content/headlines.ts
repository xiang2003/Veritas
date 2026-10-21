import type { Headline } from '../lib/recommend.ts';

const MIN_WORDS = 4;
const MAX_WORDS = 30;
const SKIP_CONTAINERS = 'nav, header, footer, [role="navigation"], [aria-hidden="true"]';
const NON_ARTICLE_PATH = /\/(video|videos|live|gallery|galleries|podcasts?|newsletters?|profiles?|search|account|subscribe|shopping|deals)(\/|$)/i;

/** A link looks like an article if it stays on this site and its path is deep enough to be a story. */
function isArticleUrl(url: URL, page: URL): boolean {
  if (!/^https?:$/.test(url.protocol)) return false;
  const sameSite = url.hostname === page.hostname || url.hostname.endsWith(`.${page.hostname.replace(/^www\./, '')}`);
  if (!sameSite || NON_ARTICLE_PATH.test(url.pathname)) return false;
  const segments = url.pathname.split('/').filter(Boolean);
  return segments.length >= 2 || /\d/.test(url.pathname) || (segments[0]?.length ?? 0) > 30;
}

/** Link text without anything Veritas inserted (e.g. the ⭐ badge). */
function linkText(a: HTMLAnchorElement): string {
  const clone = a.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.veritas-ui').forEach((n) => n.remove());
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Collect story headlines from a news front/section page.
 * Each URL appears once, with its longest link text (cards often link twice: image + title).
 */
export function collectHeadlines(doc: Document): Headline[] {
  const page = new URL(doc.location.href);
  const byUrl = new Map<string, string>();

  for (const a of doc.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (a.closest(SKIP_CONTAINERS) || a.closest('.veritas-ui')) continue;
    const title = linkText(a);
    const words = title.split(' ').length;
    if (words < MIN_WORDS || words > MAX_WORDS) continue;

    let url: URL;
    try {
      url = new URL(a.getAttribute('href')!, page);
    } catch {
      continue;
    }
    if (!isArticleUrl(url, page)) continue;
    url.hash = '';
    url.search = '';
    const key = url.href;
    if (key === page.href.split(/[?#]/)[0]) continue;
    if ((byUrl.get(key)?.length ?? 0) < title.length) byUrl.set(key, title);
  }

  return [...byUrl].map(([url, title]) => ({ url, title }));
}
