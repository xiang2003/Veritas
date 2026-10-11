import { TERM_CLASS } from './highlighter.ts';
import { BUTTON_CLASS, PANEL_CLASS } from './paragraphs.ts';

const CSS = `
.${TERM_CLASS} { text-decoration: underline; text-decoration-style: dotted;
  text-decoration-color: #4f46e5; text-decoration-thickness: 2px; text-underline-offset: 3px; cursor: help; }
.${TERM_CLASS}:hover { background: rgba(79, 70, 229, .12); }
.${BUTTON_CLASS} { float: right; margin: 2px 0 6px 14px; padding: 0 7px; height: 22px; min-width: 0;
  border: 1px solid #c7c9f5; border-radius: 6px; background: #eef0ff; color: #4f46e5;
  font: 600 12px/20px system-ui, sans-serif; cursor: pointer; opacity: .55; transition: opacity .15s; }
p:hover > .${BUTTON_CLASS}, .${BUTTON_CLASS}.open, .${BUTTON_CLASS}:focus-visible { opacity: 1; }
.${BUTTON_CLASS}.open { background: #4f46e5; color: #fff; border-color: #4f46e5; }
.${PANEL_CLASS} { clear: both; margin: 4px 0 18px; padding: 8px 12px; border-left: 3px solid #4f46e5;
  background: rgba(79, 70, 229, .08); color: inherit; font: 15px/1.6 system-ui, "Noto Sans TC", sans-serif; }
.${PANEL_CLASS}[hidden] { display: none; }`;

export function injectStyles(doc: Document): void {
  const style = doc.createElement('style');
  style.textContent = CSS;
  doc.head.append(style);
}
