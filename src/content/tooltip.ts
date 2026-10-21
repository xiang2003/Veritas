import { cambridgeUrl } from '../lib/dictionary.ts';
import type { VocabEntry } from '../lib/types.ts';
import { TERM_CLASS } from './highlighter.ts';
import { computePosition } from './tooltip-position.ts';

const HIDE_DELAY_MS = 150;

const STYLE = `
:host { all: initial; }
.card { position: fixed; z-index: 2147483647; max-width: 320px; padding: 12px 14px; display: none;
  background: #fff; color: #1b1b1f; border: 1px solid #d0d4dc; border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,.18); font: 14px/1.45 system-ui, sans-serif; }
.head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.term { font-weight: 700; font-size: 16px; }
.meta { color: #6b7280; font-size: 12px; }
button { all: unset; cursor: pointer; padding: 2px 6px; border-radius: 6px; }
button:hover { background: #eef2ff; }
.meaning { font-weight: 600; margin: 4px 0; }
.label { color: #6b7280; font-size: 12px; margin-top: 6px; }
.links { margin-top: 8px; padding-top: 6px; border-top: 1px solid #e5e7eb; font-size: 12px; }
.links a { color: #4f46e5; text-decoration: none; }
.links a:hover { text-decoration: underline; }
@media (prefers-color-scheme: dark) {
  .card { background: #1f2430; color: #e8eaf0; border-color: #3a4152; }
  button:hover { background: #2c3347; }
  .links { border-color: #3a4152; }
  .links a { color: #a5b4fc; }
}`;

function el(doc: Document, tag: string, className = '', text = ''): HTMLElement {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** Builds the card contents with textContent only – model output is never parsed as HTML. */
export function renderEntry(doc: Document, entry: VocabEntry, onSpeak: (entry: VocabEntry) => void): DocumentFragment {
  const frag = doc.createDocumentFragment();

  const head = el(doc, 'div', 'head');
  head.append(el(doc, 'span', 'term', entry.term));
  head.append(el(doc, 'span', 'meta ipa', entry.ipa)); // always present so a dictionary IPA can fill it later
  const speak = el(doc, 'button', '', '🔊');
  speak.title = 'Pronounce';
  speak.addEventListener('click', () => onSpeak(entry));
  head.append(speak);
  frag.append(head);

  if (entry.pos) frag.append(el(doc, 'div', 'meta', entry.pos));
  frag.append(el(doc, 'div', 'meaning', entry.meaning));
  if (entry.definition) frag.append(el(doc, 'div', '', entry.definition));
  if (entry.example) frag.append(el(doc, 'div', 'label', 'Example'), el(doc, 'div', '', entry.example));
  if (entry.usage) frag.append(el(doc, 'div', 'label', 'Usage'), el(doc, 'div', '', entry.usage));

  const links = el(doc, 'div', 'links');
  const cambridge = el(doc, 'a', '', 'Cambridge Dictionary ↗') as HTMLAnchorElement;
  cambridge.href = cambridgeUrl(entry.lemma || entry.term);
  cambridge.target = '_blank';
  cambridge.rel = 'noopener noreferrer';
  links.append(cambridge);
  frag.append(links);
  return frag;
}

export interface TooltipDeps {
  lookup: (term: string) => VocabEntry | undefined;
  speak: (entry: VocabEntry) => void;
  /** Optional dictionary IPA; replaces the AI-estimated one when it arrives. */
  fetchIpa?: (entry: VocabEntry) => Promise<string | undefined>;
}

/** Hover tooltip for highlighted terms (rendered in a shadow root so page CSS cannot leak in). */
export function createTooltip(doc: Document, { lookup, speak, fetchIpa }: TooltipDeps) {
  const host = doc.createElement('div');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = STYLE;
  const card = el(doc, 'div', 'card');
  shadow.append(style, card);
  doc.body.append(host);

  const win = doc.defaultView!;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let shown: VocabEntry | undefined;
  const termOf = (e: Event) => (e.target as Element | null)?.closest?.<HTMLElement>(`.${TERM_CLASS}`) ?? null;

  function show(target: HTMLElement) {
    const entry = lookup(target.dataset.term ?? '');
    if (!entry) return;
    clearTimeout(hideTimer);
    card.replaceChildren(renderEntry(doc, entry, speak));
    shown = entry;
    fetchIpa?.(entry).then((ipa) => {
      const target = card.querySelector('.ipa');
      if (ipa && shown === entry && target) target.textContent = ipa;
    }, () => {});
    card.style.display = 'block';
    const pos = computePosition(
      target.getBoundingClientRect(),
      { width: card.offsetWidth, height: card.offsetHeight },
      { width: win.innerWidth, height: win.innerHeight },
    );
    card.style.top = `${pos.top}px`;
    card.style.left = `${pos.left}px`;
  }

  const scheduleHide = () => {
    hideTimer = setTimeout(() => (card.style.display = 'none'), HIDE_DELAY_MS);
  };

  doc.addEventListener('mouseover', (e) => {
    const target = termOf(e);
    if (target) show(target);
  });
  doc.addEventListener('mouseout', (e) => {
    if (termOf(e)) scheduleHide();
  });
  card.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  card.addEventListener('mouseleave', scheduleHide);

  return { card, destroy: () => host.remove() };
}
