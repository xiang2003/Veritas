import type { JsonGenerator } from './gemini.ts';

export interface Headline {
  url: string;
  title: string;
}

export interface Recommendation extends Headline {
  /** Why this one is worth reading, in the learner's language. */
  reason: string;
  /** Estimated CEFR level of the article's language, e.g. "B2". */
  level: string;
  /** Short topic label, e.g. "Science". */
  topic: string;
}

export interface RecommendOptions {
  level: string;
  nativeLanguage: string;
  /** Free-text interests from the options page; may be empty. */
  interests: string;
}

const MAX_PICKS = 5;
const MAX_HEADLINES = 80; // keeps the prompt small on huge front pages

export function buildRecommendSystemPrompt({ level, nativeLanguage, interests }: RecommendOptions): string {
  return `You help an English learner (CEFR ${level}, native language: ${nativeLanguage}) choose what to read on a news front page.
${interests ? `Their interests: ${interests}.` : 'They did not list interests; favour broadly significant stories.'}
From the numbered headlines, pick the ${MAX_PICKS} most worth reading. Prefer stories that are:
- significant or genuinely interesting (not celebrity gossip, quizzes, deals or live tickers),
- likely to be well-written articles at a level the learner can handle with some stretch,
- varied in topic, matching their interests where possible.
Respond ONLY as JSON: {"picks":[{"id": number, "reason": string, "level": string, "topic": string}]}
- id: the headline's number
- reason: one sentence in ${nativeLanguage} on why it is worth reading
- level: your estimate of the article's CEFR level (A2–C2)
- topic: 1–2 English words`;
}

export function formatHeadlines(headlines: Headline[]): string {
  return headlines.map((h, i) => `${i + 1}. ${h.title}`).join('\n');
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Map the model's picks back to real headlines by number, so it can never invent a URL. */
export function normalizePicks(raw: unknown, headlines: Headline[]): Recommendation[] {
  const rows = (raw as { picks?: unknown } | null)?.picks;
  const seen = new Set<number>();
  const picks: Recommendation[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const index = Number(row?.id) - 1;
    const headline = headlines[index];
    if (!headline || seen.has(index)) continue;
    seen.add(index);
    picks.push({ ...headline, reason: text(row.reason), level: text(row.level), topic: text(row.topic) });
    if (picks.length === MAX_PICKS) break;
  }
  return picks;
}

export async function recommendHeadlines(
  client: JsonGenerator,
  headlines: Headline[],
  options: RecommendOptions,
): Promise<Recommendation[]> {
  const candidates = headlines.slice(0, MAX_HEADLINES);
  const raw = await client.generateJson({
    system: buildRecommendSystemPrompt(options),
    messages: [{ role: 'user', text: formatHeadlines(candidates) }],
    temperature: 0.3,
  });
  const picks = normalizePicks(raw, candidates);
  if (!picks.length) throw new Error('AI did not recommend any headline');
  return picks;
}
