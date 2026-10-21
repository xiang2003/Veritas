import { TERM_END, TERM_START, termKey, termPattern } from '../lib/vocab.ts';
import { UI_CLASS } from './paragraphs.ts';

export const TERM_CLASS = 'veritas-term';
const SKIP_SELECTOR = `script,style,noscript,textarea,input,code,pre,.${TERM_CLASS},.${UI_CLASS}`;
const SHOW_TEXT = 4; // NodeFilter.SHOW_TEXT
const FILTER_ACCEPT = 1;
const FILTER_REJECT = 2;

function buildPattern(terms: string[]): RegExp {
  // Longest first so "took off" wins over "took". Apostrophe/dash styles and spacing may differ.
  const alternatives = [...terms].sort((a, b) => b.length - a.length).map(termPattern);
  return new RegExp(`${TERM_START}(${alternatives.join('|')})${TERM_END}`, 'gi');
}

function textNodesUnder(root: Element): Text[] {
  const walker = root.ownerDocument.createTreeWalker(root, SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(SKIP_SELECTOR) ? FILTER_REJECT : FILTER_ACCEPT),
  });
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  return nodes;
}

/**
 * Underline every occurrence of the given terms inside `root`.
 * Each span carries `data-term` (see termKey) used to look the entry up on hover.
 * @returns number of spans created
 */
export function highlightTerms(root: Element, entries: { term: string }[]): number {
  if (!entries.length) return 0;
  const pattern = buildPattern(entries.map((e) => e.term));
  const doc = root.ownerDocument;
  let count = 0;

  for (const node of textNodesUnder(root)) {
    const text = node.nodeValue ?? '';
    const matches = [...text.matchAll(pattern)];
    if (!matches.length) continue;

    const fragment = doc.createDocumentFragment();
    let last = 0;
    for (const m of matches) {
      fragment.append(text.slice(last, m.index));
      const span = doc.createElement('span');
      span.className = TERM_CLASS;
      span.dataset.term = termKey(m[0]);
      span.textContent = m[0];
      fragment.append(span);
      last = m.index + m[0].length;
      count++;
    }
    fragment.append(text.slice(last));
    node.replaceWith(fragment);
  }
  return count;
}
