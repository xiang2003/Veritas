import type { ArticleData, VocabEntry } from './types.ts';

/** Content script -> background: register the article and get its vocabulary. */
export interface AnalyzeRequest {
  type: 'analyze';
  article: ArticleData;
}

export type AnalyzeResponse = { ok: true; entries: VocabEntry[] } | { ok: false; error: string };

/** storage.session key under which the background keeps each tab's current article. */
export const articleKey = (tabId: number) => `article:${tabId}`;
