import { findSurfaceForm } from './vocab.ts';
import type { WordRecord } from './wordbook.ts';

/** A looked-up word the tutor should get the learner to use. */
export interface PracticeWord {
  key: string;
  word: string;
  meaning: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PracticeOptions {
  now: number;
  /** The article being discussed: words met in it come first. */
  articleUrl: string;
  max?: number;
  withinDays?: number;
}

/**
 * Words worth practising now: still being learned and looked up recently, those from this article
 * first, then the most recent and most looked-up.
 */
export function pickPracticeWords(
  records: WordRecord[],
  { now, articleUrl, max = 5, withinDays = 7 }: PracticeOptions,
): PracticeWord[] {
  const fromArticle = (r: WordRecord) => r.contexts.some((c) => c.url === articleUrl);
  return records
    .filter((r) => !r.mastered && now - r.lastSeen <= withinDays * DAY_MS)
    .sort(
      (a, b) =>
        Number(fromArticle(b)) - Number(fromArticle(a)) || b.lastSeen - a.lastSeen || b.lookups - a.lookups,
    )
    .slice(0, max)
    .map((r) => ({ key: r.key, word: r.lemma, meaning: r.meaning }));
}

/** Practice words the learner actually used (any inflection) in what they said or typed. */
export function findUsedWords(text: string, words: PracticeWord[]): PracticeWord[] {
  return words.filter((w) => findSurfaceForm(text, w.word) !== null);
}
