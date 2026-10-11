import type { AudioClip } from '../lib/gemini.ts';
import type { RecorderLike } from '../lib/recorder.ts';
import type { TutorTurn } from '../lib/tutor.ts';
import type { ArticleData } from '../lib/types.ts';

export type Phase = 'no-article' | 'ready' | 'listening' | 'thinking' | 'speaking';

export interface TutorSessionLike {
  start(): Promise<TutorTurn>;
  send(text: string): Promise<TutorTurn>;
  sendAudio(clip: AudioClip): Promise<TutorTurn>;
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
  addUserMessage(text: string): void;
  addTutorTurn(turn: TutorTurn): void;
  showError(message: string): void;
}

export interface ControllerDeps {
  createSession: (article: ArticleData) => TutorSessionLike;
  recorder: RecorderLike;
  tts: TtsLike;
  view: View;
  getRate: () => number;
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createController({ createSession, recorder, tts, view, getRate }: ControllerDeps) {
  let session: TutorSessionLike | undefined;
  let phase: Phase = 'no-article';

  function setPhase(next: Phase) {
    phase = next;
    view.setPhase(next);
  }

  /**
   * Run one tutor turn. The learner's bubble is shown once their words are known:
   * right away for typed input, after Gemini's transcription for spoken input.
   */
  async function converse(call: (s: TutorSessionLike) => Promise<TutorTurn>) {
    if (!session) return;
    setPhase('thinking');
    try {
      const turn = await call(session);
      if (turn.transcript) view.addUserMessage(turn.transcript);
      view.addTutorTurn(turn);
      setPhase('speaking');
      await tts.speak(turn.reply, getRate());
    } catch (error) {
      view.showError(messageOf(error));
    }
    setPhase('ready');
  }

  return {
    /** Called whenever the active tab's article changes (null = no article on this page). */
    setArticle(article: ArticleData | null) {
      recorder.stop();
      tts.stop();
      view.clearConversation();
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

    async submitText(text: string) {
      const trimmed = text.trim();
      if (trimmed && phase !== 'thinking') await converse((s) => s.send(trimmed));
    },

    toggleMic() {
      if (phase === 'listening') return recorder.stop();
      if (phase === 'thinking' || !session) return;
      tts.stop();
      setPhase('listening');
      recorder.start({
        onClip: (clip) => {
          if (clip) return void converse((s) => s.sendAudio(clip));
          view.showError('No speech detected. Try again.');
          setPhase('ready');
        },
        onError: (message) => {
          view.showError(message);
          setPhase('ready');
        },
      });
    },

    replay: (text: string) => tts.speak(text, getRate()),
  };
}
