import type { ProgressSummary } from '../lib/progress.ts';
import type { SessionReview } from '../lib/review.ts';
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
  finishButton: HTMLButtonElement;
  input: HTMLInputElement;
  progress: HTMLElement;
}

/** e.g. "今日 6/10 回答 · 🔥 連續 3 天" */
export function progressLabel({ answers, goal, streak }: { answers: number; goal: number; streak: number }): string {
  const day = answers >= goal ? `✅ 今日目標達成 ${answers}/${goal}` : `今日 ${answers}/${goal} 回答`;
  return streak ? `${day} · 🔥 連續 ${streak} 天` : day;
}

/** DOM implementation of the controller's View. Model text is only ever set via textContent. */
export function createView(
  doc: Document,
  parts: ViewParts,
  onReplay: (text: string) => void,
): View & { setProgress(summary: ProgressSummary): void } {
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

  function reviewCard(r: SessionReview): HTMLElement {
    const card = el(doc, 'section', 'review');
    card.append(el(doc, 'h3', '', '🏁 本次練習總結'));
    const s = r.stats;
    const facts = [`回答 ${s.answers} 次${s.spoken ? `（口說 ${s.spoken}）` : ''}`, `糾正 ${s.corrections} 處`];
    if (r.level) facts.push(`口說程度約 ${r.level}`);
    card.append(el(doc, 'p', 'facts', facts.join(' · ')));
    if (s.usedWords.length) card.append(el(doc, 'p', 'used-words', `✓ 用上了生字：${s.usedWords.join('、')}`));
    if (r.overall) card.append(el(doc, 'p', '', r.overall));
    const list = (title: string, items: string[]) => {
      if (!items.length) return;
      card.append(el(doc, 'p', 'label', title));
      const ul = el(doc, 'ul');
      for (const item of items) ul.append(el(doc, 'li', '', item));
      card.append(ul);
    };
    list('👍 做得好', r.strengths);
    list('🎯 下次加強', r.focus);
    if (r.nextTime) card.append(el(doc, 'p', 'next', `➡️ 下次試試：${r.nextTime}`));
    if (r.progress) card.append(el(doc, 'p', 'goal', progressLabel(r.progress)));
    return card;
  }

  return {
    setProgress(summary) {
      parts.progress.textContent = progressLabel({ answers: summary.today.answers, goal: summary.goal, streak: summary.streak });
      parts.progress.classList.toggle('met', summary.goalMet);
    },
    addReview(review) {
      parts.startButton.hidden = true;
      parts.log.append(reviewCard(review));
      scrollDown();
    },
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
      parts.finishButton.disabled = busy;
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
