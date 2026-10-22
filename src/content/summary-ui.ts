import type { ArticleSummary } from '../lib/summary.ts';
import { UI_CLASS } from './paragraphs.ts';

export const SUMMARY_CLASS = 'veritas-summary';

export interface SummarySectionDeps {
  load: () => Promise<ArticleSummary>;
  /** Read English text aloud; resolves when finished or interrupted. */
  speak: (text: string) => Promise<void>;
  stop: () => void;
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className = '', text = '') {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** Controls carry UI_CLASS so other passes ignore them; the summary text does not, so it can be selected and looked up. */
function control(doc: Document, label: string) {
  const b = el(doc, 'button', `${UI_CLASS} veritas-btn`, label);
  b.type = 'button';
  return b;
}

/**
 * "📝 文章總結" section placed right after the article. Nothing is requested until the
 * learner asks for it. `attach()` re-inserts it if the site re-renders the page.
 */
export function createSummarySection(root: Element, { load, speak, stop }: SummarySectionDeps) {
  const doc = root.ownerDocument;
  const section = el(doc, 'section', SUMMARY_CLASS);
  const head = el(doc, 'div', 'veritas-summary-head');
  head.append(el(doc, 'strong', UI_CLASS, '📝 文章總結'));
  const generate = control(doc, '產生總結');
  head.append(generate);
  const body = el(doc, 'div', 'veritas-summary-body');
  section.append(head, body);

  let loading = false;
  let playing = false;

  function render(summary: ArticleSummary) {
    const english = [summary.gist, ...summary.points].filter(Boolean).join(' ');
    const parts: HTMLElement[] = [];
    if (summary.gist) parts.push(el(doc, 'p', 'veritas-summary-gist', summary.gist));
    if (summary.points.length) {
      const list = el(doc, 'ul');
      for (const point of summary.points) list.append(el(doc, 'li', '', point));
      parts.push(list);
    }

    const actions = el(doc, 'div', `${UI_CLASS} veritas-summary-actions`);
    const listen = control(doc, '🔊 朗讀');
    listen.addEventListener('click', async () => {
      if (playing) {
        stop();
        return;
      }
      playing = true;
      listen.textContent = '⏹ 停止';
      try {
        await speak(english);
      } finally {
        playing = false;
        listen.textContent = '🔊 朗讀';
      }
    });
    actions.append(listen);

    if (summary.translation) {
      const translation = el(doc, 'p', `${UI_CLASS} veritas-summary-translation`, summary.translation);
      translation.hidden = true; // try the English first
      const toggle = control(doc, '顯示中文');
      toggle.addEventListener('click', () => {
        translation.hidden = !translation.hidden;
        toggle.textContent = translation.hidden ? '顯示中文' : '隱藏中文';
      });
      actions.append(toggle);
      parts.push(actions, translation);
    } else {
      parts.push(actions);
    }
    body.replaceChildren(...parts);
    generate.hidden = true;
  }

  generate.addEventListener('click', async () => {
    if (loading) return;
    loading = true;
    generate.disabled = true;
    body.replaceChildren(el(doc, 'p', `${UI_CLASS} veritas-summary-status`, '正在整理這篇文章的重點…'));
    try {
      render(await load());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      body.replaceChildren(el(doc, 'p', `${UI_CLASS} veritas-summary-status`, `⚠ ${message}`));
      generate.textContent = '再試一次';
    } finally {
      loading = false;
      generate.disabled = false;
    }
  });

  const attach = () => {
    if (!section.isConnected) root.after(section);
  };
  attach();
  return { section, attach };
}
