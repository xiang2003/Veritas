import type { ArticleData } from '../lib/types.ts';

const ROOT_SELECTORS = [
  '[itemprop="articleBody"]',
  '.article__content', // CNN
  '[data-component="text-block"]', // BBC
  'article',
  '.article-body',
  'main',
];
const MIN_PARAGRAPHS = 3;
const MIN_CHARS = 600;
const MAX_CHARS = 30000;

export interface ExtractedArticle extends ArticleData {
  root: Element;
}

function paragraphsOf(root: Element): string[] {
  return [...root.querySelectorAll('p')]
    .map((p) => (p.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter((t) => t.length > 0);
}

/** Find the main article of a news page, or null if the page does not look like one. */
export function extractArticle(doc: Document): ExtractedArticle | null {
  for (const selector of ROOT_SELECTORS) {
    for (const root of doc.querySelectorAll(selector)) {
      const paragraphs = paragraphsOf(root);
      const text = paragraphs.join('\n');
      if (paragraphs.length >= MIN_PARAGRAPHS && text.length >= MIN_CHARS) {
        const heading = doc.querySelector('h1')?.textContent?.trim();
        return {
          url: doc.location?.href ?? '',
          title: heading || doc.title,
          text: text.slice(0, MAX_CHARS),
          root,
        };
      }
    }
  }
  return null;
}
