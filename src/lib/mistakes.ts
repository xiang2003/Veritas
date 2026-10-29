import { createJsonDoc } from './json-doc.ts';
import type { StorageLike } from './settings.ts';
import type { Correction } from './tutor.ts';

const STORAGE_KEY = 'mistakes';
const MAX_EXAMPLES = 3;

/** Where a mistake was made: the learner's whole answer and the article being discussed. */
export interface MistakeSource {
  utterance: string;
  url: string;
  title: string;
}

export interface MistakeRecord {
  key: string;
  original: string;
  corrected: string;
  explanation: string;
  /** How many times the tutor corrected this – repeated mistakes are the ones to work on. */
  count: number;
  firstSeen: number;
  lastSeen: number;
  /** The learner says they have it now; making the mistake again clears this. */
  mastered: boolean;
  /** Most recent first. */
  examples: (MistakeSource & { at: number })[];
}

type Book = Record<string, MistakeRecord>;

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[.,!?;:"“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** The same correction made in different answers shares one record. */
export const mistakeKey = (c: Pick<Correction, 'original' | 'corrected'>) => `${normalize(c.original)} → ${normalize(c.corrected)}`;

/** Still-learning first, most repeated first, then most recent. */
export function sortMistakes(records: MistakeRecord[]): MistakeRecord[] {
  return [...records].sort(
    (a, b) => Number(a.mastered) - Number(b.mastered) || b.count - a.count || b.lastSeen - a.lastSeen,
  );
}

/** Persistent "錯誤本": every correction the tutor made, grouped and counted. */
export function createMistakebook(area: StorageLike, now: () => number = Date.now) {
  const doc = createJsonDoc<Book>(area, STORAGE_KEY, () => ({}));

  return {
    record(corrections: Correction[], source: MistakeSource): Promise<MistakeRecord[]> {
      return doc.change((book) =>
        corrections.map((c) => {
          const key = mistakeKey(c);
          const at = now();
          const old = book[key];
          const record: MistakeRecord = {
            key,
            original: c.original,
            corrected: c.corrected,
            explanation: c.explanation || old?.explanation || '',
            count: (old?.count ?? 0) + 1,
            firstSeen: old?.firstSeen ?? at,
            lastSeen: at,
            mastered: false,
            examples: [{ ...source, at }, ...(old?.examples ?? [])].slice(0, MAX_EXAMPLES),
          };
          book[key] = record;
          return record;
        }),
      );
    },
    async list(): Promise<MistakeRecord[]> {
      return sortMistakes(Object.values(await doc.read()));
    },
    setMastered: (key: string, mastered: boolean) =>
      doc.change((book) => {
        if (book[key]) book[key] = { ...book[key], mastered };
      }),
    remove: (key: string) =>
      doc.change((book) => {
        delete book[key];
      }),
  };
}

export const MISTAKES_STORAGE_KEY = STORAGE_KEY;
