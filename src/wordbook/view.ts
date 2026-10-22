import { cambridgeUrl } from '../lib/dictionary.ts';
import type { WordRecord } from '../lib/wordbook.ts';

export type Tab = 'learning' | 'mastered' | 'all';

export interface Filter {
  query: string;
  tab: Tab;
}

/** Records shown for the current tab and search text (matches term, lemma or meaning). */
export function filterRecords(records: WordRecord[], { query, tab }: Filter): WordRecord[] {
  const q = query.trim().toLowerCase();
  return records.filter(
    (r) =>
      (tab === 'all' || (tab === 'mastered') === r.mastered) &&
      (!q || [r.term, r.lemma, r.meaning].some((field) => field.toLowerCase().includes(q))),
  );
}

export interface RowActions {
  speak: (record: WordRecord) => void;
  setMastered: (record: WordRecord, mastered: boolean) => void;
  remove: (record: WordRecord) => void;
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

const formatDate = (ms: number) => new Date(ms).toLocaleDateString();

/** One word card. All text goes through textContent – stored AI output is never parsed as HTML. */
export function renderRecord(doc: Document, r: WordRecord, actions: RowActions): HTMLElement {
  const card = el(doc, 'article', `word${r.mastered ? ' mastered' : ''}`);

  const head = el(doc, 'div', 'word-head');
  head.append(el(doc, 'strong', 'term', r.lemma));
  if (r.ipa) head.append(el(doc, 'span', 'muted', r.ipa));
  if (r.pos) head.append(el(doc, 'span', 'muted', r.pos));
  head.append(el(doc, 'span', 'count', `查了 ${r.lookups} 次`));
  card.append(head);

  if (r.meaning) card.append(el(doc, 'p', 'meaning', r.meaning));
  if (r.definition) card.append(el(doc, 'p', '', r.definition));
  if (r.example) card.append(el(doc, 'p', 'example', r.example));

  for (const c of r.contexts.slice(0, 2)) {
    const line = el(doc, 'p', 'context');
    const link = el(doc, 'a', '', c.title || c.url);
    link.href = c.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    line.append(`“${c.sentence}” — `, link);
    card.append(line);
  }

  const foot = el(doc, 'div', 'word-actions');
  foot.append(
    button(doc, '🔊', '發音', () => actions.speak(r)),
    r.mastered
      ? button(doc, '↺ 重新學習', '移回學習中', () => actions.setMastered(r, false))
      : button(doc, '✓ 我會了', '移到已熟悉', () => actions.setMastered(r, true)),
    button(doc, '🗑', '刪除', () => actions.remove(r)),
  );
  const cambridge = el(doc, 'a', 'dict', 'Cambridge ↗');
  cambridge.href = cambridgeUrl(r.lemma);
  cambridge.target = '_blank';
  cambridge.rel = 'noopener noreferrer';
  foot.append(cambridge);
  foot.append(el(doc, 'span', 'muted', `最近：${formatDate(r.lastSeen)}`));
  card.append(foot);
  return card;
}

export function renderList(doc: Document, records: WordRecord[], actions: RowActions): HTMLElement[] {
  if (!records.length) return [el(doc, 'p', 'empty', '還沒有單字。閱讀新聞時查看字卡、按 🔊，或反白後按「解釋」「譯」，查過的字會記在這裡。')];
  return records.map((r) => renderRecord(doc, r, actions));
}
