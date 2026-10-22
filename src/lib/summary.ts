import type { JsonGenerator } from './gemini.ts';
import type { ArticleData } from './types.ts';

export interface ArticleSummary {
  /** The article in one English sentence. */
  gist: string;
  /** 3–5 key points in English at the learner's level. */
  points: string[];
  /** Short summary in the learner's language. */
  translation: string;
}

export interface SummaryOptions {
  level: string;
  nativeLanguage: string;
}

const MAX_POINTS = 5;

export function buildSummarySystemPrompt({ level, nativeLanguage }: SummaryOptions): string {
  return `You summarise English news articles for a learner at CEFR level ${level}.
Write the English parts in clear English the learner can read (around ${level}), keeping key terms from the article. Stick to what the article says; add no facts or opinions.
Respond ONLY as JSON: {"gist": string, "points": [string], "translation": string} where
- gist: the whole story in one English sentence
- points: 3-5 key points in English, one short sentence each, in the order that best explains the story
- translation: a short summary (3-5 sentences) in ${nativeLanguage}`;
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function normalizeSummary(raw: unknown): ArticleSummary {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const points = (Array.isArray(obj.points) ? obj.points : []).map(text).filter(Boolean).slice(0, MAX_POINTS);
  const summary = { gist: text(obj.gist), points, translation: text(obj.translation) };
  if (!summary.gist && !points.length) throw new Error('No summary came back for this article');
  return summary;
}

export async function summarizeArticle(
  client: JsonGenerator,
  article: ArticleData,
  options: SummaryOptions,
): Promise<ArticleSummary> {
  const raw = await client.generateJson({
    task: 'summarize',
    system: buildSummarySystemPrompt(options),
    messages: [{ role: 'user', text: `Title: ${article.title}\n\n${article.text}` }],
    temperature: 0.3,
  });
  return normalizeSummary(raw);
}
