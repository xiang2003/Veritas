import type { TutorTurn } from '../lib/tutor.ts';
import type { Phase, View } from './controller.ts';

const PHASE_LABEL: Record<Phase, string> = {
  'no-article': 'Open an English news article in this window – Veritas turns on for it while this panel is open.',
  ready: 'Ready',
  listening: 'Recording… speak now (auto-sends after a pause)',
  thinking: 'AI 思考中…',
  speaking: 'Tutor is speaking…',
};

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document, tag: K, className = '', text = '',
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export interface ViewParts {
  title: HTMLElement;
  status: HTMLElement;
  log: HTMLElement;
  error: HTMLElement;
  startButton: HTMLButtonElement;
  micButton: HTMLButtonElement;
  sendButton: HTMLButtonElement;
  input: HTMLInputElement;
}

/** DOM implementation of the controller's View. Model text is only ever set via textContent. */
export function createView(doc: Document, parts: ViewParts, onReplay: (text: string) => void): View {
  const speakButton = (text: string) => {
    const b = el(doc, 'button', 'icon', '🔊');
    b.type = 'button';
    b.title = 'Listen';
    b.addEventListener('click', () => onReplay(text));
    return b;
  };

  const scrollDown = () => (parts.log.scrollTop = parts.log.scrollHeight);
  let thinkingTimer: ReturnType<typeof setInterval> | undefined;

  function feedbackCard(turn: TutorTurn): HTMLElement | null {
    const usedWords = turn.usedWords ?? []; // older saved turns have none
    if (!turn.corrections.length && !turn.betterAnswer && !turn.pronunciation && !usedWords.length) return null;
    const card = el(doc, 'section', 'feedback');
    if (usedWords.length) card.append(el(doc, 'p', 'used-words', `✓ 用上了生字：${usedWords.join('、')}`));
    if (turn.praise) card.append(el(doc, 'p', 'praise', turn.praise));
    for (const c of turn.corrections) {
      const item = el(doc, 'div', 'correction');
      const line = el(doc, 'p');
      line.append(el(doc, 'del', '', c.original), ' → ', el(doc, 'ins', '', c.corrected));
      item.append(line, el(doc, 'p', 'why', c.explanation));
      card.append(item);
    }
    if (turn.pronunciation) card.append(el(doc, 'p', 'pron', `🗣 ${turn.pronunciation}`));
    if (turn.betterAnswer) {
      const better = el(doc, 'div', 'better');
      better.append(el(doc, 'strong', '', 'Say it like this'), speakButton(turn.betterAnswer), el(doc, 'p', '', turn.betterAnswer));
      card.append(better);
    }
    return card;
  }

  return {
    setPhase(phase) {
      parts.status.textContent = PHASE_LABEL[phase];
      // Show how long the AI has been working, so a slow answer does not look like a frozen panel.
      clearInterval(thinkingTimer);
      if (phase === 'thinking') {
        const started = Date.now();
        thinkingTimer = setInterval(() => {
          parts.status.textContent = `${PHASE_LABEL.thinking} ${Math.round((Date.now() - started) / 1000)} 秒`;
        }, 1000);
      }
      const busy = phase === 'thinking' || phase === 'no-article';
      parts.startButton.hidden = phase !== 'ready' || parts.log.childElementCount > 0;
      parts.micButton.disabled = busy;
      parts.micButton.classList.toggle('active', phase === 'listening');
      parts.micButton.textContent = phase === 'listening' ? '⏹ Stop' : '🎤 Speak';
      parts.sendButton.disabled = busy;
      parts.input.disabled = busy;
    },
    setArticleTitle: (title) => (parts.title.textContent = title),
    clearConversation() {
      parts.log.replaceChildren();
      parts.error.textContent = '';
    },
    addUserMessage(text) {
      parts.error.textContent = '';
      parts.startButton.hidden = true;
      parts.log.append(el(doc, 'div', 'bubble user', text));
      scrollDown();
    },
    addTutorTurn(turn) {
      parts.startButton.hidden = true;
      const card = feedbackCard(turn);
      if (card) parts.log.append(card);
      const bubble = el(doc, 'div', 'bubble tutor');
      bubble.append(el(doc, 'span', '', turn.reply), speakButton(turn.reply));
      parts.log.append(bubble);
      // Older saved conversations have no hints.
      const hints = turn.hints ?? [];
      if (hints.length) {
        const box = el(doc, 'div', 'hints');
        box.append(el(doc, 'span', 'hints-label', '💡 可以這樣開頭'));
        for (const hint of hints) {
          const chip = el(doc, 'button', 'hint', hint);
          chip.type = 'button';
          chip.title = '填入輸入框';
          chip.addEventListener('click', () => {
            parts.input.value = hint.replace(/(…|\.\.\.)$/, '').trimEnd() + ' ';
            parts.input.focus();
          });
          box.append(chip);
        }
        parts.log.append(box);
      }
      scrollDown();
    },
    showError: (message) => (parts.error.textContent = message),
  };
}
