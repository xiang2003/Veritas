import type { JsonGenerator } from './gemini.ts';
import type { TutorTurn } from './tutor.ts';

/** Counted locally from the conversation – no AI needed. */
export interface SessionStats {
  answers: number;
  spoken: number;
  corrections: number;
  usedWords: string[];
}

export interface SessionReview {
  /** Overall feedback in the learner's language. */
  overall: string;
  strengths: string[];
  /** 2–3 things to work on next. */
  focus: string[];
  /** One concrete suggestion for the next session. */
  nextTime: string;
  /** Estimated CEFR level of the learner's spoken English in this session. */
  level: string;
  stats: SessionStats;
  /** Daily goal progress when the review was made (filled in by the side panel). */
  progress?: { answers: number; goal: number; streak: number };
}

export interface ReviewOptions {
  level: string;
  nativeLanguage: string;
}

/** The learner's answered turns (the tutor's opening has no transcript). */
export const learnerTurns = (turns: TutorTurn[]) => turns.filter((t) => t.transcript);

export function sessionStats(turns: TutorTurn[]): SessionStats {
  const answered = learnerTurns(turns);
  return {
    answers: answered.length,
    spoken: answered.filter((t) => t.spoken).length,
    corrections: answered.reduce((sum, t) => sum + t.corrections.length, 0),
    usedWords: [...new Set(answered.flatMap((t) => t.usedWords ?? []))],
  };
}

export function buildReviewSystemPrompt({ level, nativeLanguage }: ReviewOptions): string {
  return `You are an English speaking coach reviewing a practice session with a learner (target level CEFR ${level}).
You get the learner's answers in order, each with the corrections already given. Judge their spoken English across the whole session, be encouraging and specific, and quote their own words where useful.
Respond ONLY as JSON, all feedback in ${nativeLanguage}:
{"overall": string (2-3 sentences), "strengths": [string] (1-3), "focus": [string] (2-3 concrete things to work on, most important first), "nextTime": string (one concrete thing to try next session), "level": string (estimated CEFR level of their speaking in this session, A2-C2)}`;
}

export function formatSession(title: string, turns: TutorTurn[]): string {
  const answers = learnerTurns(turns).map((t, i) => {
    const fixes = t.corrections.map((c) => `   - "${c.original}" -> "${c.corrected}"`).join('\n');
    return `${i + 1}. ${t.spoken ? '(spoken) ' : ''}${t.transcript}${fixes ? `\n   corrections:\n${fixes}` : ''}`;
  });
  return `Article discussed: ${title}\n\nLearner answers:\n${answers.join('\n')}`;
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const list = (v: unknown, max: number) => (Array.isArray(v) ? v : []).map(text).filter(Boolean).slice(0, max);

export async function reviewSession(
  client: JsonGenerator,
  title: string,
  turns: TutorTurn[],
  options: ReviewOptions,
): Promise<SessionReview> {
  const stats = sessionStats(turns);
  if (!stats.answers) throw new Error('先回答至少一題，才能產生總結。');
  const raw = (await client.generateJson({
    task: 'review',
    system: buildReviewSystemPrompt(options),
    messages: [{ role: 'user', text: formatSession(title, turns) }],
    temperature: 0.4,
  })) as Record<string, unknown> | null;
  const review = {
    overall: text(raw?.overall),
    strengths: list(raw?.strengths, 3),
    focus: list(raw?.focus, 3),
    nextTime: text(raw?.nextTime),
    level: text(raw?.level),
    stats,
  };
  if (!review.overall && !review.focus.length) throw new Error('No review came back for this session');
  return review;
}
