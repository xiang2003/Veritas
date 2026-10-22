import type { AudioClip, JsonGenerator } from './gemini.ts';

export interface Transcription {
  /** Exactly what was said, mistakes included. Empty when no clear speech was heard. */
  transcript: string;
  /** Up to 2 clearly mispronounced words with a short tip; "" if none. */
  pronunciation: string;
}

export const INAUDIBLE = '[inaudible]';

/**
 * Deliberately context-free: no article, no conversation, no question. A model that knows what
 * the learner "should" be saying tends to hear that instead of what was actually said.
 */
export function buildTranscribeSystemPrompt(nativeLanguage: string): string {
  return `You are a strict speech-to-text engine for an English learner's recording.
- "transcript": write exactly what is said, word for word, including grammar mistakes, wrong words, repetitions, false starts and fillers (um, uh). Never correct, complete or improve anything, and never guess words from what the speaker probably meant. Write ${INAUDIBLE} for any word you cannot hear clearly. Use "" if there is no speech.
- "pronunciation": up to 2 words that were clearly mispronounced, each with a short tip in ${nativeLanguage}. Use "" if nothing clearly stood out; never guess.
Respond ONLY as JSON: {"transcript": string, "pronunciation": string}`;
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export async function transcribeSpeech(
  client: JsonGenerator,
  clip: AudioClip,
  { nativeLanguage }: { nativeLanguage: string },
): Promise<Transcription> {
  const raw = (await client.generateJson({
    task: 'transcribe',
    system: buildTranscribeSystemPrompt(nativeLanguage),
    messages: [{ role: 'user', text: 'Transcribe this recording.', audio: clip }],
    temperature: 0,
  })) as Record<string, unknown> | null;
  const transcript = text(raw?.transcript);
  // A recording that is nothing but inaudible markers carries no usable speech.
  const usable = transcript.replaceAll(INAUDIBLE, '').trim() ? transcript : '';
  return { transcript: usable, pronunciation: usable ? text(raw?.pronunciation) : '' };
}
