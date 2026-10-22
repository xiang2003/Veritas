import type { Pronunciation } from './dictionary.ts';
import type { Headline, Recommendation } from './recommend.ts';
import type { ArticleData, VocabEntry } from './types.ts';
import type { WordContext } from './wordbook.ts';

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
  /** Paragraph around a selection (selection translation only). */
  context?: string;
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

/** Content script -> background: explain a selected word or phrase as a vocabulary card. */
export interface DefineRequest {
  type: 'define';
  term: string;
  context: string;
  title: string;
}

export type DefineResponse = { ok: true; entry: VocabEntry } | { ok: false; error: string };

/** Content script -> background: the learner looked a word up; add it to their wordbook. */
export interface RecordLookupRequest {
  type: 'record-lookup';
  entry: VocabEntry;
  context: WordContext;
  /** false: only update the card (this page already counted a lookup of the word). */
  count?: boolean;
}

export type RecordLookupResponse = { ok: true } | { ok: false; error: string };

export type Request =
  | AnalyzeRequest
  | TranslateRequest
  | RecommendRequest
  | PronounceRequest
  | DefineRequest
  | RecordLookupRequest;
export type Response =
  | AnalyzeResponse
  | TranslateResponse
  | RecommendResponse
  | PronounceResponse
  | DefineResponse
  | RecordLookupResponse;

/** Side panel -> content script: turn Veritas on for this tab. */
export interface ActivateMessage {
  type: 'activate';
}

/** storage.session key under which the background keeps each tab's current article. */
export const articleKey = (tabId: number) => `article:${tabId}`;
