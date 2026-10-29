import { createJsonDoc } from './json-doc.ts';
import type { StorageLike } from './settings.ts';
import type { VocabEntry } from './types.ts';
import { termKey } from './vocab.ts';

const STORAGE_KEY = 'wordbook';
const MAX_CONTEXTS = 5;
const MAX_SENTENCE_CHARS = 300;

/** Where a word was met. */
export interface WordContext {
  url: string;
  title: string;
  sentence: string;
}

export interface WordRecord {
  key: string;
  term: string;
  lemma: string;
  pos: string;
  ipa: string;
  meaning: string;
  definition: string;
  example: string;
  /** How many times the learner looked this word up – the unfamiliarity signal. */
  lookups: number;
  firstSeen: number;
  lastSeen: number;
  /** Marked as known by the learner; looking it up again makes it unknown again. */
  mastered: boolean;
  /** Most recent first. */
  contexts: WordContext[];
  /** Times the learner used the word in a tutor conversation (absent on older records). */
  uses?: number;
}

type Book = Record<string, WordRecord>;

/** The sentence of `text` that contains `term` (or the start of the text if it is not found). */
export function sentenceAround(text: string, term: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const at = clean.toLowerCase().indexOf(term.toLowerCase());
  if (at < 0) return clean.slice(0, MAX_SENTENCE_CHARS);
  const start = Math.max(clean.lastIndexOf('. ', at), clean.lastIndexOf('? ', at), clean.lastIndexOf('! ', at));
  const ends = ['. ', '? ', '! '].map((p) => clean.indexOf(p, at + term.length)).filter((i) => i >= 0);
  const end = ends.length ? Math.min(...ends) + 1 : clean.length;
  return clean.slice(start < 0 ? 0 : start + 2, end).slice(0, MAX_SENTENCE_CHARS);
}

/** Learning words first, most looked-up first, then most recent. */
export function sortRecords(records: WordRecord[]): WordRecord[] {
  return [...records].sort(
    (a, b) => Number(a.mastered) - Number(b.mastered) || b.lookups - a.lookups || b.lastSeen - a.lastSeen,
  );
}

const csvCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;

/** CSV for spreadsheet / flash-card import (Anki etc.). */
export function toCsv(records: WordRecord[]): string {
  const header = ['term', 'lemma', 'pos', 'ipa', 'meaning', 'definition', 'example', 'lookups', 'context', 'source'];
  const rows = records.map((r) =>
    [r.term, r.lemma, r.pos, r.ipa, r.meaning, r.definition, r.example, r.lookups, r.contexts[0]?.sentence ?? '', r.contexts[0]?.url ?? '']
      .map(csvCell)
      .join(','),
  );
  return [header.join(','), ...rows].join('\r\n');
}

/**
 * Persistent record of the words the learner looks up (one queued JSON document, so lookups from
 * several tabs at once are all counted).
 */
export function createWordbook(area: StorageLike, now: () => number = Date.now) {
  const doc = createJsonDoc<Book>(area, STORAGE_KEY, () => ({}));
  const change = doc.change;

  return {
    /**
     * Save a lookup. With `count: false` the card/context are updated without counting another lookup
     * (e.g. the same word explained again on the same page).
     */
    record(entry: VocabEntry, context: WordContext, { count = true } = {}): Promise<WordRecord> {
      return change((book) => {
        const key = termKey(entry.lemma || entry.term);
        const at = now();
        const old = book[key];
        const contexts = [context, ...(old?.contexts ?? []).filter((c) => c.url !== context.url)].slice(0, MAX_CONTEXTS);
        const pick = (field: 'pos' | 'ipa' | 'meaning' | 'definition' | 'example') => entry[field] || old?.[field] || '';
        const record: WordRecord = {
          key,
          term: entry.term,
          lemma: entry.lemma || entry.term,
          pos: pick('pos'),
          ipa: pick('ipa'),
          meaning: pick('meaning'),
          definition: pick('definition'),
          example: pick('example'),
          lookups: (old?.lookups ?? 0) + (count ? 1 : 0),
          firstSeen: old?.firstSeen ?? at,
          lastSeen: at,
          mastered: count ? false : (old?.mastered ?? false),
          contexts,
        };
        book[key] = record;
        return record;
      });
    },
    async list(): Promise<WordRecord[]> {
      return sortRecords(Object.values(await doc.read()));
    },
    /** The learner used these words (by key) in a conversation. Unknown keys are ignored. */
    markUsed: (keys: string[]) =>
      change((book) => {
        for (const key of keys) if (book[key]) book[key] = { ...book[key], uses: (book[key].uses ?? 0) + 1 };
      }),
    setMastered: (key: string, mastered: boolean) =>
      change((book) => {
        if (book[key]) book[key] = { ...book[key], mastered };
      }),
    remove: (key: string) =>
      change((book) => {
        delete book[key];
      }),
  };
}

export const WORDBOOK_STORAGE_KEY = STORAGE_KEY;
