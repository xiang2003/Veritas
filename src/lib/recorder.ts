import type { AudioClip } from './gemini.ts';

/* ---------- Silence detection (pure, timing injected) ---------- */

export interface SilenceOptions {
  /** RMS level (0..1) above which we consider the learner to be speaking. */
  threshold: number;
  /** Silence after speech that ends the recording. */
  silenceMs: number;
  /** Give up if nobody speaks at all for this long. */
  noSpeechMs: number;
}

export type SilenceVerdict = 'continue' | 'end-of-speech' | 'no-speech';

/** Feed it audio levels over time; it says when the answer is finished. */
export function createSilenceDetector({ threshold, silenceMs, noSpeechMs }: SilenceOptions, startedAt: number) {
  let lastVoiceAt: number | undefined;
  return {
    push(level: number, now: number): SilenceVerdict {
      if (level >= threshold) lastVoiceAt = now;
      if (lastVoiceAt === undefined) return now - startedAt >= noSpeechMs ? 'no-speech' : 'continue';
      return now - lastVoiceAt >= silenceMs ? 'end-of-speech' : 'continue';
    },
  };
}

export function rmsLevel(samples: ArrayLike<number>): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / samples.length);
}

export async function blobToClip(blob: Blob): Promise<AudioClip> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { mimeType: blob.type.split(';')[0] || 'audio/webm', data: btoa(binary) };
}

/* ---------- Recorder ---------- */

export interface RecorderHandlers {
  /** The finished recording, or null when nothing was said. */
  onClip: (clip: AudioClip | null) => void;
  onError: (message: string) => void;
}

export interface RecorderLike {
  start(handlers: RecorderHandlers): void;
  stop(): void;
}

const POLL_MS = 100;
const DEFAULTS = { threshold: 0.02, silenceMs: 2500, noSpeechMs: 8000 };

/** Records the microphone and stops by itself after the learner finishes speaking. */
export function createRecorder(options: Partial<SilenceOptions> = {}): RecorderLike {
  const silence = { ...DEFAULTS, ...options };
  let stopNow: (() => void) | undefined;

  return {
    stop: () => stopNow?.(),
    start({ onClip, onError }) {
      stopNow?.();
      navigator.mediaDevices
        .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
        .then((stream) => {
          const chunks: Blob[] = [];
          const recorder = new MediaRecorder(stream);
          const audioContext = new AudioContext();
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 1024;
          audioContext.createMediaStreamSource(stream).connect(analyser);
          const buffer = new Float32Array(analyser.fftSize);
          const detector = createSilenceDetector(silence, performance.now());
          let heardSpeech = false;

          const poll = setInterval(() => {
            analyser.getFloatTimeDomainData(buffer);
            const level = rmsLevel(buffer);
            heardSpeech ||= level >= silence.threshold;
            if (detector.push(level, performance.now()) !== 'continue') stopNow?.();
          }, POLL_MS);

          stopNow = () => {
            stopNow = undefined;
            if (recorder.state !== 'inactive') recorder.stop();
          };

          recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
          recorder.onstop = async () => {
            clearInterval(poll);
            stream.getTracks().forEach((t) => t.stop());
            void audioContext.close();
            if (!heardSpeech) return onClip(null);
            onClip(await blobToClip(new Blob(chunks, { type: recorder.mimeType })));
          };
          recorder.start();
        })
        .catch(() => onError('Microphone access was denied. Grant it from the extension options page.'));
    },
  };
}
