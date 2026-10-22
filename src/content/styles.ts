import { TERM_CLASS } from './highlighter.ts';
import { BUTTON_CLASS, PANEL_CLASS, TOOLS_CLASS } from './paragraphs.ts';
import { PICK_BADGE_CLASS } from './recommend-ui.ts';
import { SUMMARY_CLASS } from './summary-ui.ts';

const CSS = `
.${TERM_CLASS} { text-decoration: underline; text-decoration-style: dotted;
  text-decoration-color: #4f46e5; text-decoration-thickness: 2px; text-underline-offset: 3px; cursor: help; }
.${TERM_CLASS}:hover { background: rgba(79, 70, 229, .12); }
.${TOOLS_CLASS} { float: right; display: inline-flex; gap: 4px; margin: 2px 0 6px 14px; opacity: .55; transition: opacity .15s; }
p:hover > .${TOOLS_CLASS}, .${TOOLS_CLASS}:focus-within { opacity: 1; }
.${BUTTON_CLASS} { margin: 0; padding: 0 7px; height: 22px; min-width: 0; border: 1px solid #c7c9f5; border-radius: 6px;
  background: #eef0ff; color: #4f46e5; font: 600 12px/20px system-ui, sans-serif; cursor: pointer; }
.${BUTTON_CLASS}.open { background: #4f46e5; color: #fff; border-color: #4f46e5; }
.${PANEL_CLASS} { clear: both; margin: 4px 0 18px; padding: 8px 12px; border-left: 3px solid #4f46e5;
  background: rgba(79, 70, 229, .08); color: inherit; font: 15px/1.6 system-ui, "Noto Sans TC", sans-serif; }
.${PANEL_CLASS}[hidden] { display: none; }
.${PICK_BADGE_CLASS} { display: inline-block; margin-right: 6px; padding: 1px 7px; border-radius: 999px; vertical-align: middle;
  background: #4f46e5; color: #fff; font: 600 11px/18px system-ui, "Noto Sans TC", sans-serif; text-decoration: none; }
.${SUMMARY_CLASS} { clear: both; margin: 28px 0; padding: 16px 18px; border: 1px solid #c7c9f5; border-left: 4px solid #4f46e5;
  border-radius: 10px; background: rgba(79, 70, 229, .05); color: inherit; font: 16px/1.6 system-ui, "Noto Sans TC", sans-serif; }
.${SUMMARY_CLASS} .veritas-summary-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.${SUMMARY_CLASS} .veritas-summary-head strong { font-size: 17px; }
.${SUMMARY_CLASS} .veritas-btn { height: auto; padding: 3px 10px; }
.${SUMMARY_CLASS} .veritas-btn[hidden] { display: none; }
.${SUMMARY_CLASS} p, .${SUMMARY_CLASS} ul { margin: 10px 0 0; }
.${SUMMARY_CLASS} ul { padding-left: 22px; }
.${SUMMARY_CLASS} li { margin: 4px 0; }
.${SUMMARY_CLASS} .veritas-summary-gist { font-weight: 600; }
.${SUMMARY_CLASS} .veritas-summary-actions { display: flex; gap: 6px; margin-top: 12px; }
.${SUMMARY_CLASS} .veritas-summary-translation { padding-top: 10px; border-top: 1px dashed #c7c9f5; }
.${SUMMARY_CLASS} .veritas-summary-translation[hidden] { display: none; }
.${SUMMARY_CLASS} .veritas-summary-status { opacity: .8; }`;

const STYLE_ID = 'veritas-styles';

/** Add Veritas' page styles once (safe to call repeatedly). */
export function injectStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.append(style);
}
