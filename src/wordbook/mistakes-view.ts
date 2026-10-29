import type { MistakeRecord } from '../lib/mistakes.ts';
import type { Tab } from './view.ts';

/** Mistakes shown for the current tab and search text (matches the wrong or the corrected text). */
export function filterMistakes(records: MistakeRecord[], { query, tab }: { query: string; tab: Tab }): MistakeRecord[] {
  const q = query.trim().toLowerCase();
  return records.filter(
    (r) =>
      (tab === 'all' || (tab === 'mastered') === r.mastered) &&
      (!q || [r.original, r.corrected, r.explanation].some((field) => field.toLowerCase().includes(q))),
  );
}

export interface MistakeActions {
  speak: (record: MistakeRecord) => void;
  setMastered: (record: MistakeRecord, mastered: boolean) => void;
  remove: (record: MistakeRecord) => void;
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className = '', text = '') {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(doc: Document, label: string, title: string, onClick: () => void) {
  const b = el(doc, 'button', 'secondary', label);
  b.type = 'button';
  b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

/** One mistake card. All text goes through textContent – stored AI output is never parsed as HTML. */
export function renderMistake(doc: Document, r: MistakeRecord, actions: MistakeActions): HTMLElement {
  const card = el(doc, 'article', `word mistake${r.mastered ? ' mastered' : ''}`);

  const head = el(doc, 'div', 'word-head');
  const fix = el(doc, 'p', 'fix');
  fix.append(el(doc, 'del', '', r.original), ' → ', el(doc, 'ins', '', r.corrected));
  head.append(fix, el(doc, 'span', 'count', `錯了 ${r.count} 次`));
  card.append(head);
  if (r.explanation) card.append(el(doc, 'p', '', r.explanation));

  for (const e of r.examples.slice(0, 2)) {
    const line = el(doc, 'p', 'context');
    const link = el(doc, 'a', '', e.title || e.url);
    link.href = e.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    line.append(e.utterance ? `你說：“${e.utterance}” — ` : '', link);
    card.append(line);
  }

  const foot = el(doc, 'div', 'word-actions');
  foot.append(
    button(doc, '🔊', '聽正確說法', () => actions.speak(r)),
    r.mastered
      ? button(doc, '↺ 重新練習', '移回練習中', () => actions.setMastered(r, false))
      : button(doc, '✓ 我記住了', '移到已記住', () => actions.setMastered(r, true)),
    button(doc, '🗑', '刪除', () => actions.remove(r)),
  );
  foot.append(el(doc, 'span', 'muted', `最近：${new Date(r.lastSeen).toLocaleDateString()}`));
  card.append(foot);
  return card;
}

export function renderMistakeList(doc: Document, records: MistakeRecord[], actions: MistakeActions): HTMLElement[] {
  if (!records.length) return [el(doc, 'p', 'empty', '還沒有錯誤紀錄。和 AI 教練練習口說時，被糾正的地方會記在這裡。')];
  return records.map((r) => renderMistake(doc, r, actions));
}
