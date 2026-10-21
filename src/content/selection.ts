import { cambridgeUrl } from '../lib/dictionary.ts';
import type { VocabEntry } from '../lib/types.ts';
import { UI_CLASS } from './paragraphs.ts';
import { computePosition } from './tooltip-position.ts';

const MAX_SELECTION_CHARS = 1000;
const MAX_CONTEXT_CHARS = 800;
const BLOCKS = 'p, li, blockquote, h1, h2, h3, h4, h5, h6, td, dd, figcaption';
const IGNORED = `.${UI_CLASS}, input, textarea, [contenteditable=""], [contenteditable="true"]`;

export interface SelectedText {
  text: string;
  /** Text of the paragraph (or similar block) the selection sits in. */
  context: string;
  rect: { top: number; bottom: number; left: number };
}

export const isSingleWord = (text: string) => /^[A-Za-z][A-Za-z'’-]*$/.test(text);

/** Words and short phrases (up to 4 words) can be explained as a vocabulary card. */
export const isShortTerm = (text: string) => text.split(' ').length <= 4 && /^[A-Za-z][A-Za-z'’ -]*$/.test(text);

const clean = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Text of the block around `el`, without anything Veritas inserted. */
export function blockText(el: Element): string {
  const clone = (el.closest(BLOCKS) ?? el).cloneNode(true) as Element;
  clone.querySelectorAll(`.${UI_CLASS}`).forEach((n) => n.remove());
  return clean(clone.textContent ?? '').slice(0, MAX_CONTEXT_CHARS);
}

/** The current selection if it is English page text worth translating, else null. */
export function readSelection(selection: Selection | null): SelectedText | null {
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const text = clean(selection.toString());
  if (!text || text.length > MAX_SELECTION_CHARS || !/[A-Za-z]/.test(text)) return null;

  const node = selection.anchorNode;
  const el = node?.nodeType === 1 ? (node as Element) : node?.parentElement;
  if (!el || el.closest(IGNORED)) return null;

  const range = selection.getRangeAt(0);
  const box = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : undefined;
  return { text, context: blockText(el), rect: { top: box?.top ?? 0, bottom: box?.bottom ?? 0, left: box?.left ?? 0 } };
}

const STYLE = `
:host { all: initial; }
.card { position: fixed; z-index: 2147483647; display: none; max-width: 360px; padding: 6px;
  background: #fff; color: #1b1b1f; border: 1px solid #d0d4dc; border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,.18); font: 14px/1.5 system-ui, "Noto Sans TC", sans-serif; }
.bar { display: flex; gap: 4px; }
button { all: unset; cursor: pointer; padding: 3px 9px; border-radius: 6px; font-weight: 600; color: #4f46e5; background: #eef0ff; }
button:hover { background: #e0e4ff; }
.ipa { color: #6b7280; font-size: 12px; padding: 4px 6px 0; }
.out { padding: 6px 6px 2px; }
.out:empty, .ipa:empty { display: none; }
.bar button[hidden] { display: none; }
.out .meaning { font-weight: 700; }
.out .meta, .out .label { color: #6b7280; font-size: 12px; }
.out .label { margin-top: 6px; }
.out a { color: #4f46e5; font-size: 12px; text-decoration: none; }
.out a:hover { text-decoration: underline; }
@media (prefers-color-scheme: dark) {
  .card { background: #1f2430; color: #e8eaf0; border-color: #3a4152; }
  button { background: #2c3347; color: #a5b4fc; }
  .ipa, .out .meta, .out .label { color: #9aa3b5; }
  .out a { color: #a5b4fc; }
}`;

export interface SelectionPopupDeps {
  translate: (text: string, context: string) => Promise<string>;
  /** Full vocabulary card for a short selection, explained in the sense of its passage. */
  define: (text: string, context: string) => Promise<VocabEntry>;
  /** Called after a successful explanation (e.g. to underline the term on the page). */
  onDefined?: (entry: VocabEntry) => void;
  pronounce: (text: string) => Promise<void>;
  /** Dictionary IPA for a single word, if known. */
  ipaOf: (word: string) => Promise<string | undefined>;
}

/** Small toolbar shown next to selected text: 🔊 read it aloud, 譯 translate it in context. */
export function createSelectionPopup(doc: Document, { translate, define, onDefined, pronounce, ipaOf }: SelectionPopupDeps) {
  const win = doc.defaultView!;
  const host = doc.createElement('div');
  host.className = UI_CLASS;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${STYLE}</style>
    <div class="card"><div class="bar"><button class="speak" title="朗讀">🔊</button><button class="tr" title="翻譯">譯</button><button class="def" title="解釋">解釋</button></div>
    <div class="ipa"></div><div class="out"></div></div>`;
  doc.body.append(host);

  const card = shadow.querySelector<HTMLElement>('.card')!;
  const ipaLine = shadow.querySelector<HTMLElement>('.ipa')!;
  const out = shadow.querySelector<HTMLElement>('.out')!;
  const defineButton = shadow.querySelector<HTMLElement>('.def')!;
  let current: SelectedText | undefined;
  let docTop = 0; // card top in document coordinates, so it follows the text when scrolling

  function hide() {
    current = undefined;
    card.style.display = 'none';
  }

  function show(selected: SelectedText) {
    current = selected;
    ipaLine.textContent = '';
    out.textContent = '';
    defineButton.hidden = !isShortTerm(selected.text);
    card.style.display = 'block';
    const pos = computePosition(
      selected.rect,
      { width: card.offsetWidth, height: card.offsetHeight },
      { width: win.innerWidth, height: win.innerHeight },
    );
    docTop = pos.top + win.scrollY;
    card.style.top = `${pos.top}px`;
    card.style.left = `${pos.left}px`;
    if (isSingleWord(selected.text)) {
      ipaOf(selected.text).then((ipa) => {
        if (ipa && current === selected) ipaLine.textContent = ipa;
      }, () => {});
    }
  }

  // Keep the selection alive while clicking the toolbar.
  card.addEventListener('mousedown', (e) => e.preventDefault());

  shadow.querySelector('.speak')!.addEventListener('click', () => {
    if (current) void pronounce(current.text);
  });

  shadow.querySelector('.tr')!.addEventListener('click', async () => {
    const selected = current;
    if (!selected) return;
    out.textContent = '翻譯中…';
    try {
      const translation = await translate(selected.text, selected.context);
      if (current === selected) out.textContent = translation;
    } catch (error) {
      if (current === selected) out.textContent = `⚠ ${error instanceof Error ? error.message : String(error)}`;
    }
  });

  function line(className: string, text: string) {
    const div = doc.createElement('div');
    div.className = className;
    div.textContent = text;
    return div;
  }

  /** Render a vocabulary card with textContent only – model output is never parsed as HTML. */
  function renderEntry(entry: VocabEntry) {
    const parts: HTMLElement[] = [];
    const meta = [entry.pos, entry.lemma !== entry.term ? entry.lemma : ''].filter(Boolean).join(' · ');
    if (meta) parts.push(line('meta', meta));
    parts.push(line('meaning', entry.meaning));
    if (entry.definition) parts.push(line('', entry.definition));
    if (entry.example) parts.push(line('label', 'Example'), line('', entry.example));
    if (entry.usage) parts.push(line('label', 'Usage'), line('', entry.usage));
    const link = doc.createElement('a');
    link.href = cambridgeUrl(entry.lemma || entry.term);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Cambridge Dictionary ↗';
    parts.push(link);
    out.replaceChildren(...parts);
  }

  defineButton.addEventListener('click', async () => {
    const selected = current;
    if (!selected) return;
    out.textContent = '解釋中…';
    try {
      const entry = await define(selected.text, selected.context);
      onDefined?.(entry);
      if (current !== selected) return;
      renderEntry(entry);
      if (entry.ipa && !ipaLine.textContent) ipaLine.textContent = entry.ipa;
    } catch (error) {
      if (current === selected) out.textContent = `⚠ ${error instanceof Error ? error.message : String(error)}`;
    }
  });

  doc.addEventListener('mouseup', (e) => {
    if (e.composedPath().includes(host)) return;
    // Let the browser finish updating the selection first.
    setTimeout(() => {
      const selected = readSelection(doc.getSelection());
      if (selected) show(selected);
      else hide();
    }, 0);
  });
  doc.addEventListener('keydown', (e) => e.key === 'Escape' && hide());
  win.addEventListener('scroll', () => (card.style.top = `${docTop - win.scrollY}px`), { passive: true });

  return { card, hide, destroy: () => host.remove() };
}
