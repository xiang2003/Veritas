import { createJsonDoc } from './json-doc.ts';
import type { StorageLike } from './settings.ts';

const STORAGE_KEY = 'progress';

export interface DayStats {
  /** Answers given to the tutor (typed or spoken) – what the daily goal counts. */
  answers: number;
  spokenAnswers: number;
  /** Words looked up while reading. */
  lookups: number;
  /** Conversations finished with a review. */
  reviews: number;
}

/** Per local calendar day, keyed "YYYY-MM-DD". */
export type ProgressLog = Record<string, DayStats>;

const EMPTY: DayStats = { answers: 0, spokenAnswers: 0, lookups: 0, reviews: 0 };

/** Local calendar day of a timestamp, e.g. "2026-10-29". */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function previousDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return dayKey(new Date(y, m - 1, d - 1, 12).getTime()); // noon: safe across daylight-saving changes
}

export interface ProgressSummary {
  today: DayStats;
  goal: number;
  goalMet: boolean;
  /** Consecutive days the goal was met, up to today – or up to yesterday while today is still open. */
  streak: number;
}

export function summarizeProgress(log: ProgressLog, goal: number, now: number): ProgressSummary {
  const todayKey = dayKey(now);
  const today = { ...EMPTY, ...log[todayKey] };
  const met = (key: string) => (log[key]?.answers ?? 0) >= goal;
  let day = met(todayKey) ? todayKey : previousDay(todayKey);
  let streak = 0;
  while (met(day)) {
    streak++;
    day = previousDay(day);
  }
  return { today, goal, goalMet: today.answers >= goal, streak };
}

/** Daily learning statistics. Write from one context (the service worker); read anywhere. */
export function createProgress(area: StorageLike, now: () => number = Date.now) {
  const doc = createJsonDoc<ProgressLog>(area, STORAGE_KEY, () => ({}));
  return {
    track: (delta: Partial<DayStats>) =>
      doc.change((log) => {
        const key = dayKey(now());
        const day = { ...EMPTY, ...log[key] };
        for (const field of Object.keys(EMPTY) as (keyof DayStats)[]) day[field] += delta[field] ?? 0;
        log[key] = day;
      }),
    read: () => doc.read(),
  };
}

export const PROGRESS_STORAGE_KEY = STORAGE_KEY;
