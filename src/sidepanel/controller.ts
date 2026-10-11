import type { ArticleData } from '../lib/types.ts';
import type { TutorTurn } from '../lib/tutor.ts';

export type Phase = 'no-article' | 'ready' | 'listening' | 'thinking' | 'speaking';

export interface TutorSessionLike {
  start(): Promise<TutorTurn>;
  send(text: string): Promise<TutorTurn>;
}

export interface SttLike {
  supported: boolean;
  start(handlers: {
    onResult: (transcript: string, final: boolean) => void;
    onError: (message: string) => void;
    onEnd: () => void;
  }): void;
  stop(): void;
}

export interface TtsLike {
  speak(text: string, rate?: number): Promise<void>;
  stop(): void;
}

/** Everything the controller needs to show; implemented by the DOM view and by test fakes. */
export interface View {
  setPhase(phase: Phase): void;
  setArticleTitle(title: string): void;
  clearConversation(): void;
  setDraft(text: string): void;
  addUserMessage(text: string): void;
  addTutorTurn(turn: TutorTurn): void;
  showError(message: string): void;
}

export interface ControllerDeps {
  createSession: (article: ArticleData) => TutorSessionLike;
  stt: SttLike;
  tts: TtsLike;
  view: View;
  getRate: () => number;
  /** Silence after the last word before the answer is submitted automatically. */
  silenceMs?: number;
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

const DEFAULT_SILENCE_MS = 2500;

export function createController({ createSession, stt, tts, view, getRate, silenceMs = DEFAULT_SILENCE_MS }: ControllerDeps) {
  let session: TutorSessionLike | undefined;
  let phase: Phase = 'no-article';
  let pending = ''; // transcript heard but not yet submitted
  let silenceTimer: ReturnType<typeof setTimeout> | undefined;

  function setPhase(next: Phase) {
    phase = next;
    view.setPhase(next);
  }

  /** Send one learner turn (spoken or typed) and speak the tutor's answer. */
  async function converse(call: (s: TutorSessionLike) => Promise<TutorTurn>, userText?: string) {
    if (!session) return;
    if (userText) view.addUserMessage(userText);
    setPhase('thinking');
    try {
      const turn = await call(session);
      view.addTutorTurn(turn);
      setPhase('speaking');
      await tts.speak(turn.reply, getRate());
    } catch (error) {
      view.showError(messageOf(error));
    }
    setPhase('ready');
  }

  async function submit(text: string) {
    const trimmed = text.trim();
    clearTimeout(silenceTimer);
    pending = '';
    view.setDraft('');
    if (trimmed && phase !== 'thinking') await converse((s) => s.send(trimmed), trimmed);
  }

  return {
    /** Called whenever the active tab's article changes (null = no article on this page). */
    setArticle(article: ArticleData | null) {
      stt.stop();
      tts.stop();
      view.clearConversation();
      clearTimeout(silenceTimer);
      pending = '';
      if (!article) {
        session = undefined;
        view.setArticleTitle('');
        return setPhase('no-article');
      }
      session = createSession(article);
      view.setArticleTitle(article.title);
      setPhase('ready');
    },

    start: () => converse((s) => s.start()),

    submitText: submit,

    toggleMic() {
      if (phase === 'listening') return stt.stop();
      if (phase === 'thinking' || !session) return;
      tts.stop();
      setPhase('listening');
      stt.start({
        onResult: (transcript) => {
          pending = transcript;
          view.setDraft(transcript);
          // Submit only after a real pause, not at the first breath.
          clearTimeout(silenceTimer);
          silenceTimer = setTimeout(() => stt.stop(), silenceMs);
        },
        onError: (message) => {
          clearTimeout(silenceTimer);
          pending = '';
          view.showError(message);
        },
        onEnd: () => {
          // Recognition ended without a final result: don't lose what was heard.
          if (pending) void submit(pending);
          else if (phase === 'listening') setPhase('ready');
        },
      });
    },

    replay: (text: string) => tts.speak(text, getRate()),
  };
}

