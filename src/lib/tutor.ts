import type { AudioClip, ChatMessage, JsonGenerator } from './gemini.ts';
import type { ArticleData } from './types.ts';

export interface Correction {
  original: string;
  corrected: string;
  explanation: string;
}

export interface TutorTurn {
  /** Verbatim transcript of what the learner said (typed text is echoed as-is). Empty on the opening turn. */
  transcript: string;
  /** What the tutor says back (spoken aloud). */
  reply: string;
  /** Mistakes in the learner's last utterance. Empty on the opening turn. */
  corrections: Correction[];
  /** A more natural / advanced way to say what the learner meant. */
  betterAnswer: string;
  /** Pronunciation notes for clearly mispronounced words (spoken answers only). */
  pronunciation: string;
  /** One short encouraging remark. */
  praise: string;
}

export interface TutorOptions {
  level: string;
  nativeLanguage: string;
}

/** Sent as the first user message to make the tutor open the discussion. */
export const START_SIGNAL = '[START]';
const AUDIO_PROMPT = '(The learner answered by voice – the audio is attached.)';

export function buildTutorSystemPrompt(article: ArticleData, { level, nativeLanguage }: TutorOptions): string {
  return `You are a friendly English speaking coach. The learner (CEFR ${level}, native language: ${nativeLanguage}) just read this news article and wants to discuss it out loud. Answers arrive as audio recordings or as typed text.

ARTICLE
Title: ${article.title}
${article.text}

RULES
- Keep "reply" short (2-3 sentences), conversational, and end with one question that moves the discussion forward. Mix comprehension, opinion and "what would you do" questions.
- If the learner's message is ${JSON.stringify(START_SIGNAL)}, open by briefly greeting them and asking the first question about the article. Leave transcript, corrections, betterAnswer and pronunciation empty.
- If audio is attached, first write "transcript": exactly what the learner said, word for word, INCLUDING their grammar mistakes and false starts. Never fix or improve it. If the audio is silent or unintelligible, use "" and ask them in "reply" to try again (corrections = []).
- Analyse the learner's last answer: list real grammar, word-choice or unnatural-phrasing mistakes in "corrections" (max 3, most important first; explanations in ${nativeLanguage}). Do not invent mistakes; use [] if it was fine.
- "betterAnswer": rewrite what the learner said as a fluent, natural ${level}+ speaker would, reusing their ideas and, where fitting, vocabulary from the article.
- "pronunciation": for spoken answers only, up to 2 words that were clearly mispronounced, with a short tip in ${nativeLanguage}. Use "" if nothing stood out; never guess.
- "praise": one short encouraging sentence in English.

Respond ONLY as JSON: {"transcript": string, "reply": string, "corrections": [{"original": string, "corrected": string, "explanation": string}], "betterAnswer": string, "pronunciation": string, "praise": string}`;
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function parseTutorTurn(raw: unknown): TutorTurn {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const reply = text(obj.reply);
  if (!reply) throw new Error('Tutor returned no reply');
  const corrections = (Array.isArray(obj.corrections) ? obj.corrections : [])
    .map((c: any) => ({ original: text(c?.original), corrected: text(c?.corrected), explanation: text(c?.explanation) }))
    .filter((c) => c.original && c.corrected);
  return {
    transcript: text(obj.transcript),
    reply,
    corrections,
    betterAnswer: text(obj.betterAnswer),
    pronunciation: text(obj.pronunciation),
    praise: text(obj.praise),
  };
}

/** Holds the conversation history for one article. */
export function createTutorSession(client: JsonGenerator, article: ArticleData, options: TutorOptions) {
  const history: ChatMessage[] = [];
  const system = buildTutorSystemPrompt(article, options);

  async function say(message: ChatMessage, historyText: (turn: TutorTurn) => string): Promise<TutorTurn> {
    const messages = [...history, message];
    const turn = parseTutorTurn(await client.generateJson({ system, messages, temperature: 0.7 }));
    // Only commit once the call succeeded, so a failure can simply be retried.
    // Audio is not kept in history (it is large); the transcript stands in for it.
    history.push({ role: 'user', text: historyText(turn) }, { role: 'model', text: turn.reply });
    return turn;
  }

  return {
    start: () => say({ role: 'user', text: START_SIGNAL }, () => START_SIGNAL),
    async send(userText: string): Promise<TutorTurn> {
      const turn = await say({ role: 'user', text: userText }, () => userText);
      return { ...turn, transcript: userText };
    },
    sendAudio: (audio: AudioClip) =>
      say({ role: 'user', text: AUDIO_PROMPT, audio }, (turn) => turn.transcript || '(unintelligible)'),
    get length() {
      return history.length;
    },
  };
}
