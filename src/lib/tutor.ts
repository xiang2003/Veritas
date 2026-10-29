import type { AudioClip, ChatMessage, JsonGenerator } from './gemini.ts';
import { findUsedWords, type PracticeWord } from './practice.ts';
import { INAUDIBLE, transcribeSpeech } from './transcribe.ts';
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
  /** Up to 3 sentence starters / useful phrases that help the learner answer the new question. */
  hints: string[];
  /** Practice words the learner used in this answer (filled in by the session). */
  usedWords: string[];
}

export interface TutorOptions {
  level: string;
  nativeLanguage: string;
}

/** Sent as the first user message to make the tutor open the discussion. */
export const START_SIGNAL = '[START]';
/** Marks learner messages that came from speech-to-text rather than typing. */
export const SPOKEN_PREFIX = '[spoken] ';

/** Prompt section asking the tutor to get the learner to use words they recently looked up. */
export function practiceSection(words: PracticeWord[]): string {
  if (!words.length) return '';
  const list = words.map((w) => (w.meaning ? `${w.word} (${w.meaning})` : w.word)).join(', ');
  return `
WORDS TO PRACTISE – the learner looked these up recently: ${list}
- About every other question, make it natural to use one of these words and ask for it explicitly in "reply" (e.g. Try to use "${words[0]!.word}" in your answer.), and make one of the "hints" a sentence starter that uses that word.
- When the learner uses one of these words correctly, praise that specifically; if they use it wrongly, correct it.
`;
}

export function buildTutorSystemPrompt(
  article: ArticleData,
  { level, nativeLanguage }: TutorOptions,
  practiceWords: PracticeWord[] = [],
): string {
  return `You are a friendly English speaking coach. The learner (CEFR ${level}, native language: ${nativeLanguage}) just read this news article and wants to discuss it out loud. Their answers are typed, or are speech transcripts prefixed with ${JSON.stringify(SPOKEN_PREFIX.trim())}.

ARTICLE
Title: ${article.title}
${article.text}

RULES
- You lead the conversation. The learner finds open-ended prompts like "What do you think?" hard to start, so every "reply" must end with exactly ONE concrete, specific question that is easy to begin answering.
- Guide them step by step: start with simple questions whose answer is in the article (who, what happened, where, why), then move to cause and effect, then to their opinion, their own country or experience, and "what would you do" questions. Only go deeper once they answer the easier ones well.
- Keep "reply" short (1-3 sentences): briefly react to what they said, then ask the next question.
- If they say they don't know, answer very briefly, or seem stuck, do not move on: ask the same thing more simply, or offer two options to choose from ("Do you think A or B?").
- "hints": 2-3 short sentence starters or useful phrases (in English, ideally using words from the article) that help answer YOUR new question, e.g. "The article says that…", "I think the main reason is…". Never write the full answer.
- If the learner's message is ${JSON.stringify(START_SIGNAL)}, greet them in one short sentence and ask the first, easy question about the main event of the article. Leave corrections and betterAnswer empty.
- Speech transcripts are verbatim: ignore punctuation and capitalisation, and do not list fillers (um, uh), repetitions or false starts as mistakes. ${INAUDIBLE} marks a word that could not be heard – do not guess it or correct it.
- Analyse the learner's last answer: list real grammar, word-choice or unnatural-phrasing mistakes in "corrections" (max 3, most important first; explanations in ${nativeLanguage}). Do not invent mistakes; use [] if it was fine.
- "betterAnswer": rewrite what the learner said as a fluent, natural ${level}+ speaker would, reusing their ideas and, where fitting, vocabulary from the article.
- "praise": one short encouraging sentence in English.
${practiceSection(practiceWords)}
Respond ONLY as JSON: {"reply": string, "corrections": [{"original": string, "corrected": string, "explanation": string}], "betterAnswer": string, "praise": string, "hints": [string]}`;
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Parse the tutor's reply. transcript/pronunciation are filled in by the session, never by the tutor. */
export function parseTutorTurn(raw: unknown): TutorTurn {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const reply = text(obj.reply);
  if (!reply) throw new Error('Tutor returned no reply');
  const corrections = (Array.isArray(obj.corrections) ? obj.corrections : [])
    .map((c: any) => ({ original: text(c?.original), corrected: text(c?.corrected), explanation: text(c?.explanation) }))
    .filter((c) => c.original && c.corrected);
  return {
    transcript: '',
    reply,
    corrections,
    betterAnswer: text(obj.betterAnswer),
    pronunciation: '',
    praise: text(obj.praise),
    hints: (Array.isArray(obj.hints) ? obj.hints : []).map(text).filter(Boolean).slice(0, 3),
    usedWords: [],
  };
}

/** Holds the conversation history for one article. */
export function createTutorSession(
  client: JsonGenerator,
  article: ArticleData,
  options: TutorOptions,
  initialHistory: ChatMessage[] = [],
  practiceWords: PracticeWord[] = [],
) {
  const history: ChatMessage[] = [...initialHistory];
  const system = buildTutorSystemPrompt(article, options, practiceWords);
  const used = (said: string) => findUsedWords(said, practiceWords).map((w) => w.word);

  async function say(userText: string): Promise<TutorTurn> {
    const messages: ChatMessage[] = [...history, { role: 'user', text: userText }];
    const turn = parseTutorTurn(await client.generateJson({ task: 'tutor', system, messages, temperature: 0.7 }));
    // Only commit once the call succeeded, so a failure can simply be retried.
    history.push({ role: 'user', text: userText }, { role: 'model', text: turn.reply });
    return turn;
  }

  return {
    start: () => say(START_SIGNAL),
    async send(userText: string): Promise<TutorTurn> {
      return { ...(await say(userText)), transcript: userText, usedWords: used(userText) };
    },
    /**
     * Spoken answer: first a separate, context-free transcription (so the tutor's expectations cannot
     * bend what was heard), then the tutor reacts to the transcript like to a typed answer. Two requests.
     */
    async sendAudio(audio: AudioClip): Promise<TutorTurn> {
      const { transcript, pronunciation } = await transcribeSpeech(client, audio, options);
      if (!transcript) throw new Error('沒有聽清楚你說的話，請再說一次。');
      const turn = await say(SPOKEN_PREFIX + transcript);
      return { ...turn, transcript, pronunciation, usedWords: used(transcript) };
    },
    get length() {
      return history.length;
    },
    get history(): ChatMessage[] {
      return [...history];
    },
  };
}
