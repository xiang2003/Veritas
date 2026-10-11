const LANG = 'en-US';

/* ---------- Text to speech ---------- */

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

/* ---------- Speech to text ---------- */

export interface SttHandlers {
  /** Called with the best transcript so far; `final` is true once the utterance is complete. */
  onResult: (transcript: string, final: boolean) => void;
  onError: (message: string) => void;
  onEnd: () => void;
}

export interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
}

const STT_ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access was denied. Grant it from the extension options page.',
  'service-not-allowed': 'Microphone access was denied. Grant it from the extension options page.',
  'no-speech': 'No speech detected. Try again.',
  'audio-capture': 'No microphone found.',
  network: 'Speech recognition needs an internet connection.',
};

export function createStt(makeRecognition: (() => RecognitionLike) | undefined) {
  let active: RecognitionLike | undefined;
  return {
    supported: Boolean(makeRecognition),
    start({ onResult, onError, onEnd }: SttHandlers): void {
      if (!makeRecognition) return onError('Speech recognition is not supported in this browser.');
      active?.stop();
      const rec = makeRecognition();
      rec.lang = LANG;
      rec.interimResults = true;
      rec.continuous = false;
      rec.onresult = (e) => {
        const results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> = e.results;
        const parts = Array.from(results, (r) => r[0]!.transcript);
        onResult(parts.join(' ').trim(), Array.from(results).every((r) => r.isFinal));
      };
      rec.onerror = (e) => onError(STT_ERRORS[e.error] ?? `Speech recognition error: ${e.error}`);
      rec.onend = () => {
        if (active === rec) active = undefined;
        onEnd();
      };
      active = rec;
      rec.start();
    },
    stop: () => active?.stop(),
  };
}
