import type { Pronunciation } from '../lib/dictionary.ts';

export interface PronouncerDeps {
  /** Dictionary lookup (via the background worker); null when the word is unknown. */
  lookup: (word: string) => Promise<Pronunciation | null>;
  /** Play a recording; rejects if the page blocks it (e.g. its CSP disallows the media host). */
  playAudio: (url: string) => Promise<void>;
  /** Browser speech synthesis fallback. */
  speak: (text: string) => Promise<void>;
}

/** Plays a human recording when the dictionary has one, else falls back to synthetic speech. */
export function createPronouncer({ lookup, playAudio, speak }: PronouncerDeps) {
  const cache = new Map<string, Promise<Pronunciation | null>>();

  function find(word: string): Promise<Pronunciation | null> {
    const key = word.trim().toLowerCase();
    if (!cache.has(key)) cache.set(key, lookup(key).catch(() => null));
    return cache.get(key)!;
  }

  return {
    find,
    async pronounce(word: string, spokenText = word): Promise<void> {
      const found = await find(word);
      if (found?.audioUrl) {
        try {
          return await playAudio(found.audioUrl);
        } catch {
          // fall through to synthetic speech
        }
      }
      await speak(spokenText);
    },
  };
}

/** Promise wrapper around an <audio> element. */
export function playAudioUrl(url: string, createAudio: (url: string) => HTMLAudioElement = (u) => new Audio(u)): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = createAudio(url);
    audio.onended = () => resolve();
    audio.onerror = () => reject(new Error('audio failed'));
    audio.play().catch(reject);
  });
}
