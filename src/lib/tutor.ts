import type { ChatMessage, JsonGenerator } from './gemini.ts';
import type { ArticleData } from './types.ts';

export interface Correction {
  original: string;
  corrected: string;
  explanation: string;
}

export interface TutorTurn {
  /** What the tutor says back (spoken aloud). */
  reply: string;
  /** Mistakes in the learner's last utterance. Empty on the opening turn. */
  corrections: Correction[];
  /** A more natural / advanced way to say what the learner meant. */
  betterAnswer: string;
  /** One short encouraging remark. */
  praise: string;
}

export interface TutorOptions {
  level: string;
  nativeLanguage: string;
}

/** Sent as the first user message to make the tutor open the discussion. */
export const START_SIGNAL = '[START]';

export function buildTutorSystemPrompt(article: ArticleData, { level, nativeLanguage }: TutorOptions): string {
  return `You are a friendly English speaking coach. The learner (CEFR ${level}, native language: ${nativeLanguage}) just read this news article and wants to discuss it out loud. Their messages are speech-to-text transcripts, so ignore capitalization and punctuation issues.

ARTICLE
Title: ${article.title}
${article.text}

RULES
- Keep "reply" short (2-3 sentences), conversational, and end with one question that moves the discussion forward. Mix comprehension, opinion and "what would you do" questions.
- If the learner's message is ${JSON.stringify(START_SIGNAL)}, open by briefly greeting them and asking the first question about the article. Leave corrections empty and betterAnswer "".
- Otherwise analyse the learner's last message: list real grammar, word-choice or unnatural-phrasing mistakes in "corrections" (max 3, most important first; explanations in ${nativeLanguage}). Do not invent mistakes; use [] if it was fine.
- "betterAnswer": rewrite what the learner said as a fluent, natural ${level}+ speaker would, reusing their ideas and, where fitting, vocabulary from the article.
- "praise": one short encouraging sentence in English.

Respond ONLY as JSON: {"reply": string, "corrections": [{"original": string, "corrected": string, "explanation": string}], "betterAnswer": string, "praise": string}`;
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function parseTutorTurn(raw: unknown): TutorTurn {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const reply = text(obj.reply);
  if (!reply) throw new Error('Tutor returned no reply');
  const corrections = (Array.isArray(obj.corrections) ? obj.corrections : [])
    .map((c: any) => ({ original: text(c?.original), corrected: text(c?.corrected), explanation: text(c?.explanation) }))
    .filter((c) => c.original && c.corrected);
  return { reply, corrections, betterAnswer: text(obj.betterAnswer), praise: text(obj.praise) };
}

/** Holds the conversation history for one article. */
export function createTutorSession(client: JsonGenerator, article: ArticleData, options: TutorOptions) {
  const history: ChatMessage[] = [];
  const system = buildTutorSystemPrompt(article, options);

  async function say(userText: string): Promise<TutorTurn> {
    const messages: ChatMessage[] = [...history, { role: 'user', text: userText }];
    const turn = parseTutorTurn(await client.generateJson({ system, messages, temperature: 0.7 }));
    // Only commit to history once the call succeeded, so a failure can simply be retried.
    history.push({ role: 'user', text: userText }, { role: 'model', text: turn.reply });
    return turn;
  }

  return {
    start: () => say(START_SIGNAL),
    send: (userText: string) => say(userText),
    get length() {
      return history.length;
    },
  };
}
