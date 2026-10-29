import type { AudioClip, ChatMessage } from '../lib/gemini.ts';
import type { RecorderLike } from '../lib/recorder.ts';
import type { TutorTurn } from '../lib/tutor.ts';
import type { ArticleData } from '../lib/types.ts';

export type Phase = 'no-article' | 'ready' | 'listening' | 'thinking' | 'speaking';

export interface TutorSessionLike {
  /** Messages the model has seen so far (used to resume the conversation later). */
  readonly history: ChatMessage[];
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

/** One line of the visible conversation, kept so it can be redrawn when the user returns to an article. */
export type DisplayItem = { kind: 'user'; text: string } | { kind: 'tutor'; turn: TutorTurn };

export interface SavedConversation {
  history: ChatMessage[];
  items: DisplayItem[];
}

export interface ConversationStore {
  load(url: string): Promise<SavedConversation | null>;
  save(url: string, conversation: SavedConversation): Promise<void>;
}

export interface ControllerDeps {
  createSession: (article: ArticleData, history: ChatMessage[]) => TutorSessionLike;
  store: ConversationStore;
  recorder: RecorderLike;
  tts: TtsLike;
  view: View;
  getRate: () => number;
  /** Whether the tutor should open a new conversation by itself (e.g. only when an API key is set). */
  autoStart?: () => boolean;
  /**
   * After each answered learner turn (typed or spoken), e.g. to collect corrections in the mistakes
   * book and count progress. Called even if the learner has switched to another article meanwhile.
   */
  onLearnerTurn?: (turn: TutorTurn, article: ArticleData, spoken: boolean) => void;
}

interface ActiveConversation {
  url: string;
  article: ArticleData;
  session: TutorSessionLike;
  items: DisplayItem[];
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createController({
  createSession,
  store,
  recorder,
  tts,
  view,
  getRate,
  autoStart = () => false,
  onLearnerTurn,
}: ControllerDeps) {
  let active: ActiveConversation | undefined;
  let phase: Phase = 'no-article';
  let loadId = 0; // guards against overlapping setArticle() calls while a saved conversation loads

  function setPhase(next: Phase) {
    phase = next;
    view.setPhase(next);
  }

  function show(item: DisplayItem) {
    if (item.kind === 'user') view.addUserMessage(item.text);
    else view.addTutorTurn(item.turn);
  }

  /**
   * Run one tutor turn. The learner's bubble is shown once their words are known:
   * right away for typed input, after Gemini's transcription for spoken input.
   * If the user switched to another article meanwhile, the turn is still saved to its own
   * conversation but not drawn.
   */
  async function converse(call: (s: TutorSessionLike) => Promise<TutorTurn>, learner?: { spoken: boolean }) {
    const conversation = active;
    if (!conversation) return;
    setPhase('thinking');
    try {
      const turn = await call(conversation.session);
      const items: DisplayItem[] = [];
      if (turn.transcript) items.push({ kind: 'user', text: turn.transcript });
      items.push({ kind: 'tutor', turn });
      conversation.items.push(...items);
      if (learner) onLearnerTurn?.(turn, conversation.article, learner.spoken);
      store
        .save(conversation.url, { history: conversation.session.history, items: conversation.items })
        .catch(() => {}); // losing the saved copy must not break the live conversation
      if (active !== conversation) return;
      items.forEach(show);
      setPhase('speaking');
      await tts.speak(turn.reply, getRate());
    } catch (error) {
      if (active === conversation) view.showError(messageOf(error));
    }
    if (active === conversation) setPhase('ready');
  }

  return {
    /** Called whenever the active tab's article changes (null = no article on this page). */
    async setArticle(article: ArticleData | null) {
      const id = ++loadId;
      recorder.stop();
      tts.stop();
      view.clearConversation();
      active = undefined;
      if (!article) {
        view.setArticleTitle('');
        return setPhase('no-article');
      }
      view.setArticleTitle(article.title);
      setPhase('thinking'); // disables input while the saved conversation loads
      const saved = await store.load(article.url).catch(() => null);
      if (id !== loadId) return; // another article was selected in the meantime
      active = { url: article.url, article, session: createSession(article, saved?.history ?? []), items: saved?.items ?? [] };
      active.items.forEach(show);
      setPhase('ready');
      // A fresh conversation starts with the tutor's first guiding question, not with the learner.
      if (!active.items.length && autoStart()) await converse((s) => s.start());
    },

    start: () => converse((s) => s.start()),

    async submitText(text: string) {
      const trimmed = text.trim();
      if (trimmed && phase !== 'thinking') await converse((s) => s.send(trimmed), { spoken: false });
    },

    toggleMic() {
      if (phase === 'listening') return recorder.stop();
      if (phase === 'thinking' || !active) return;
      tts.stop();
      setPhase('listening');
      recorder.start({
        onClip: (clip) => {
          if (clip) return void converse((s) => s.sendAudio(clip), { spoken: true });
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
