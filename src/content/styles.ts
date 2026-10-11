import { TERM_CLASS } from './highlighter.ts';

const CSS = `
.${TERM_CLASS} { text-decoration: underline; text-decoration-style: dotted;
  text-decoration-color: #4f46e5; text-decoration-thickness: 2px; text-underline-offset: 3px; cursor: help; }
.${TERM_CLASS}:hover { background: rgba(79, 70, 229, .12); }`;

export function injectStyles(doc: Document): void {
  const style = doc.createElement('style');
  style.textContent = CSS;
  doc.head.append(style);
}
