import type { Pronunciation } from './dictionary.ts';
import type { Headline, Recommendation } from './recommend.ts';
import type { MistakeSource } from './mistakes.ts';
import type { DayStats } from './progress.ts';
import type { ArticleSummary } from './summary.ts';
import type { Correction } from './tutor.ts';
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

/** Content script -> background: summarise the article. */
export interface SummarizeRequest {
  type: 'summarize';
  article: ArticleData;
}

export type SummarizeResponse = { ok: true; summary: ArticleSummary } | { ok: false; error: string };

/** Side panel -> background: corrections from one learner answer, for the mistakes book. */
export interface RecordMistakesRequest {
  type: 'record-mistakes';
  corrections: Correction[];
  source: MistakeSource;
}

export type RecordMistakesResponse = { ok: true } | { ok: false; error: string };

/** Side panel -> background: the learner used these wordbook words (by key) in a conversation. */
export interface RecordPracticeRequest {
  type: 'record-practice';
  keys: string[];
}

export type RecordPracticeResponse = { ok: true } | { ok: false; error: string };

/** Side panel -> background: add to today's learning statistics. */
export interface TrackProgressRequest {
  type: 'track-progress';
  delta: Partial<DayStats>;
}

export type TrackProgressResponse = { ok: true } | { ok: false; error: string };

export type Request =
  | AnalyzeRequest
  | TranslateRequest
  | RecommendRequest
  | PronounceRequest
  | DefineRequest
  | RecordLookupRequest
  | SummarizeRequest
  | RecordMistakesRequest
  | RecordPracticeRequest
  | TrackProgressRequest;
export type Response =
  | AnalyzeResponse
  | TranslateResponse
  | RecommendResponse
  | PronounceResponse
  | DefineResponse
  | RecordLookupResponse
  | SummarizeResponse
  | RecordMistakesResponse
  | RecordPracticeResponse
  | TrackProgressResponse;

/** Content script -> background, during a user gesture: open the tutor side panel. */
export interface OpenPanelMessage {
  type: 'open-panel';
}

/** Side panel -> content script: turn Veritas on for this tab. */
export interface ActivateMessage {
  type: 'activate';
}

/** storage.session key under which the background keeps each tab's current article. */
export const articleKey = (tabId: number) => `article:${tabId}`;
