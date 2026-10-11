const LANG = 'en-US';

export interface TtsDeps {
  synth: Pick<SpeechSynthesis, 'speak' | 'cancel' | 'getVoices'>;
  createUtterance: (text: string) => SpeechSynthesisUtterance;
}

/** Prefer a US English voice; fall back to any English voice, then the browser default. */
export function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  return voices.find((v) => v.lang === LANG) ?? voices.find((v) => v.lang.startsWith('en'));
}

export function createTts({ synth, createUtterance }: TtsDeps) {
  return {
    /** Speak `text`, interrupting anything already playing. Resolves when finished. */
    speak(text: string, rate = 1): Promise<void> {
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
    },
    stop: () => synth.cancel(),
  };
}
