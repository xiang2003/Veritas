const LANG = 'en-US';
const MAX_CHUNK_CHARS = 220; // Chrome cuts off long utterances on some voices

export interface TtsDeps {
  synth: Pick<SpeechSynthesis, 'speak' | 'cancel' | 'getVoices'>;
  createUtterance: (text: string) => SpeechSynthesisUtterance;
}

/** Prefer a US English voice; fall back to any English voice, then the browser default. */
export function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  return voices.find((v) => v.lang === LANG) ?? voices.find((v) => v.lang.startsWith('en'));
}

/** Split into sentences, and overly long sentences at commas, so each chunk is safe to speak. */
export function splitIntoChunks(text: string): string[] {
  const chunks: string[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (sentence.length <= MAX_CHUNK_CHARS) {
      chunks.push(sentence);
      continue;
    }
    let current = '';
    for (const part of sentence.split(/(?<=[,;:])\s+/)) {
      if (current && current.length + part.length + 1 > MAX_CHUNK_CHARS) {
        chunks.push(current);
        current = part;
      } else {
        current = current ? `${current} ${part}` : part;
      }
    }
    chunks.push(current);
  }
  return chunks.map((c) => c.trim()).filter(Boolean);
}

export function createTts({ synth, createUtterance }: TtsDeps) {
  let run = 0; // bumped by every speak()/stop() so a superseded playback stops queueing chunks

  function speakChunk(text: string, rate: number): Promise<void> {
    return new Promise((resolve) => {
      const utterance = createUtterance(text);
      utterance.lang = LANG;
      utterance.rate = rate;
      const voice = pickVoice(synth.getVoices());
      if (voice) utterance.voice = voice;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve(); // "interrupted" by cancel() is expected, not a failure
      synth.cancel();
      synth.speak(utterance);
    });
  }

  return {
    /** Speak `text`, interrupting anything already playing. Resolves when finished or interrupted. */
    async speak(text: string, rate = 1): Promise<void> {
      const id = ++run;
      for (const chunk of splitIntoChunks(text)) {
        if (id !== run) return;
        await speakChunk(chunk, rate);
      }
    },
    stop() {
      run++;
      synth.cancel();
    },
  };
}
