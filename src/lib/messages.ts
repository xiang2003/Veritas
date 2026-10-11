import type { ArticleData, VocabEntry } from './types.ts';

/** Content script -> background: register the article and get its vocabulary. */
export interface AnalyzeRequest {
  type: 'analyze';
  article: ArticleData;
}

export type AnalyzeResponse = { ok: true; entries: VocabEntry[] } | { ok: false; error: string };

/** Content script -> background: translate one paragraph into the learner's language. */
export interface TranslateRequest {
  type: 'translate';
  text: string;
  title: string;
}

export type TranslateResponse = { ok: true; translation: string } | { ok: false; error: string };

export type Request = AnalyzeRequest | TranslateRequest;

/** storage.session key under which the background keeps each tab's current article. */
export const articleKey = (tabId: number) => `article:${tabId}`;
