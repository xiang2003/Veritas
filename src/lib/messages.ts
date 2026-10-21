import type { Pronunciation } from './dictionary.ts';
import type { Headline, Recommendation } from './recommend.ts';
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

/** Content script -> background: pick the articles worth reading from a front page's headlines. */
export interface RecommendRequest {
  type: 'recommend';
  pageUrl: string;
  headlines: Headline[];
  /** Ignore a cached result (the user asked to refresh). */
  force?: boolean;
}

export type RecommendResponse = { ok: true; picks: Recommendation[] } | { ok: false; error: string };

/** Content script -> background: dictionary IPA and human recording for a word. */
export interface PronounceRequest {
  type: 'pronounce';
  word: string;
}

export type PronounceResponse = { ok: true; pronunciation: Pronunciation | null } | { ok: false; error: string };

export type Request = AnalyzeRequest | TranslateRequest | RecommendRequest | PronounceRequest;
export type Response = AnalyzeResponse | TranslateResponse | RecommendResponse | PronounceResponse;

/** Side panel -> content script: turn Veritas on for this tab. */
export interface ActivateMessage {
  type: 'activate';
}

/** storage.session key under which the background keeps each tab's current article. */
export const articleKey = (tabId: number) => `article:${tabId}`;
